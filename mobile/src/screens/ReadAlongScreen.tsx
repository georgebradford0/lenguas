import React, { useState, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  FlatList, Platform, ListRenderItemInfo,
} from 'react-native';
import { pick, keepLocalCopy, isErrorWithCode, errorCodes } from '@react-native-documents/picker';
import { colors, spacing, fontSize, borderRadius } from '../styles/theme';
import { parseEpub, loadChapter } from '../utils/epubParser';
import { EpubReader } from '../components/EpubReader';
import { TranslationCard } from '../components/TranslationCard';
import { WordContextMenu } from '../components/WordContextMenu';
import { SentenceModePanel, PANEL_HEIGHT } from '../components/SentenceModePanel';
import type { EpubHandle, TocEntry, Chapter, Sentence } from '../utils/epubParser';
import type { Language } from '../types';

type Phase = 'idle' | 'parsing' | 'toc' | 'chapterLoading' | 'reading';

const CARD_HEIGHT = 230;

interface SelectedWord {
  wordId: string;
  word: string;
  sentence: string;
}

interface ContextMenuState {
  visible: boolean;
  wordId: string;
  word: string;
  sentence: Sentence | null;
}

export function ReadAlongScreen({ language, onBack }: { language: Language; onBack: () => void }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const epubRef = useRef<EpubHandle | null>(null);
  const [epubTitle, setEpubTitle] = useState<string | null>(null);
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [currentChapter, setCurrentChapter] = useState<Chapter | null>(null);
  const [currentTocIdx, setCurrentTocIdx] = useState(0);
  const [selected, setSelected] = useState<SelectedWord | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false, wordId: '', word: '', sentence: null,
  });
  const [sentenceModeActive, setSentenceModeActive] = useState(false);
  const [sentenceModeIdx, setSentenceModeIdx] = useState(0);

  // ── File picker ─────────────────────────────────────────────────────────────

  async function handleSelectEpub() {
    try {
      setError(null);
      const [result] = await pick({
        type: Platform.OS === 'ios' ? 'org.idpf.epub-container' : 'application/epub+zip',
      });

      setPhase('parsing');
      const copies = await keepLocalCopy({
        files: [{ uri: result.uri, fileName: result.name ?? 'book.epub' }],
        destination: 'cachesDirectory',
      });
      const copy = copies[0];
      if (copy.status !== 'success') throw new Error('Failed to copy file');

      const handle = await parseEpub(copy.localUri);
      epubRef.current = handle;
      setEpubTitle(handle.title);
      setToc(handle.toc);
      setSelected(null);
      setPhase('toc');
    } catch (e: any) {
      if (!isErrorWithCode(e) || e.code !== errorCodes.OPERATION_CANCELED) {
        setError('Failed to open epub.');
        console.error(e);
      }
      setPhase('idle');
    }
  }

  // ── Chapter loading ──────────────────────────────────────────────────────────

  async function openChapter(tocIdx: number) {
    const handle = epubRef.current;
    if (!handle) return;
    const entry = handle.toc[tocIdx];
    if (!entry) return;

    setPhase('chapterLoading');
    setSelected(null);
    try {
      // Find spine index for this href (strip anchor for matching)
      const spineIdx = handle.spineHrefs.findIndex(h => h === entry.href);
      const chapterIdx = spineIdx >= 0 ? spineIdx : tocIdx;
      const chapter = await loadChapter(handle.zip, entry.href, chapterIdx, entry.title);
      setCurrentChapter(chapter);
      setCurrentTocIdx(tocIdx);
      setPhase('reading');
    } catch (e: any) {
      setError('Failed to load chapter.');
      setPhase('toc');
    }
  }

  // ── Word press ───────────────────────────────────────────────────────────────

  const handleWordPress = useCallback((wordId: string, word: string, sentence: Sentence) => {
    if (sentenceModeActive) return;
    setSelected({ wordId, word, sentence: sentence.raw });
  }, [sentenceModeActive]);

  const handleWordLongPress = useCallback((wordId: string, word: string, sentence: Sentence) => {
    setContextMenu({ visible: true, wordId, word, sentence });
  }, []);

  // ── Rendering ────────────────────────────────────────────────────────────────

  if (phase === 'idle') {
    return (
      <View style={styles.centeredContainer}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.screenTitle}>Read Along</Text>
        {epubTitle && (
          <View style={styles.bookCard}>
            <Text style={styles.bookIcon}>📖</Text>
            <Text style={styles.bookTitle}>{epubTitle}</Text>
          </View>
        )}
        <TouchableOpacity style={styles.primaryButton} onPress={handleSelectEpub} activeOpacity={0.85}>
          <Text style={styles.primaryButtonText}>{epubTitle ? 'Change Book' : 'Select EPUB'}</Text>
        </TouchableOpacity>
        {epubTitle && (
          <TouchableOpacity style={styles.secondaryButton} onPress={() => setPhase('toc')} activeOpacity={0.85}>
            <Text style={styles.secondaryButtonText}>Open Table of Contents</Text>
          </TouchableOpacity>
        )}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>
    );
  }

  if (phase === 'parsing') {
    return (
      <View style={styles.centeredContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Parsing epub…</Text>
      </View>
    );
  }

  if (phase === 'toc') {
    return (
      <View style={styles.fullContainer}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.headerBack} onPress={() => setPhase('idle')}>
            <Text style={styles.headerBackText}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>{epubTitle}</Text>
          <View style={styles.headerRight} />
        </View>
        <FlatList
          data={toc}
          keyExtractor={e => e.id}
          renderItem={({ item, index }: ListRenderItemInfo<TocEntry>) => (
            <TouchableOpacity
              style={[styles.tocItem, item.level > 0 && { paddingLeft: spacing.md + item.level * 16 }]}
              onPress={() => openChapter(index)}
              activeOpacity={0.7}
            >
              <Text style={[styles.tocItemText, item.level > 0 && styles.tocItemSubText]} numberOfLines={2}>
                {item.title}
              </Text>
              <Text style={styles.tocChevron}>›</Text>
            </TouchableOpacity>
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          contentContainerStyle={{ paddingBottom: spacing.xl }}
        />
      </View>
    );
  }

  if (phase === 'chapterLoading') {
    return (
      <View style={styles.centeredContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading chapter…</Text>
      </View>
    );
  }

  // ── Reading ──────────────────────────────────────────────────────────────────

  if (phase === 'reading' && currentChapter) {
    const prevIdx = currentTocIdx > 0 ? currentTocIdx - 1 : null;
    const nextIdx = currentTocIdx < toc.length - 1 ? currentTocIdx + 1 : null;

    const allSentences = currentChapter.paragraphs.flatMap(p => p.sentences);
    const highlightedSentenceId = sentenceModeActive ? (allSentences[sentenceModeIdx]?.id ?? null) : null;

    return (
      <View style={styles.fullContainer}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.headerBack} onPress={() => { setSelected(null); setSentenceModeActive(false); setPhase('toc'); }}>
            <Text style={styles.headerBackText}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>{currentChapter.title}</Text>
          <Text style={styles.chapterCounter}>{currentTocIdx + 1}/{toc.length}</Text>
        </View>

        {/* Chapter content */}
        <EpubReader
          chapter={currentChapter}
          selectedWordId={sentenceModeActive ? null : (selected?.wordId ?? null)}
          highlightedSentenceId={highlightedSentenceId}
          onWordPress={handleWordPress}
          onWordLongPress={handleWordLongPress}
          bottomPadding={sentenceModeActive ? PANEL_HEIGHT : (selected ? CARD_HEIGHT : 0)}
        />

        {/* Chapter navigation — hidden during sentence mode */}
        {!sentenceModeActive && (
          <View style={styles.chapterNav}>
            <TouchableOpacity
              style={[styles.navButton, !prevIdx && prevIdx !== 0 && styles.navButtonDisabled]}
              onPress={prevIdx !== null ? () => openChapter(prevIdx) : undefined}
              disabled={prevIdx === null}
            >
              <Text style={styles.navButtonText}>‹ Prev</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.navButton, nextIdx === null && styles.navButtonDisabled]}
              onPress={nextIdx !== null ? () => openChapter(nextIdx) : undefined}
              disabled={nextIdx === null}
            >
              <Text style={styles.navButtonText}>Next ›</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Translation card — hidden during sentence mode */}
        {selected && !sentenceModeActive && (
          <TranslationCard
            wordId={selected.wordId}
            word={selected.word}
            sentence={selected.sentence}
            language={language}
            onDismiss={() => setSelected(null)}
          />
        )}

        {/* Word context menu (long-press popup) */}
        <WordContextMenu
          visible={contextMenu.visible}
          onDismiss={() => setContextMenu(prev => ({ ...prev, visible: false }))}
          onSentenceBysentence={() => {
            if (!contextMenu.sentence) return;
            const idx = allSentences.findIndex(s => s.id === contextMenu.sentence!.id);
            setSentenceModeIdx(idx >= 0 ? idx : 0);
            setSelected(null);
            setSentenceModeActive(true);
          }}
        />

        {/* Sentence-by-sentence panel */}
        {sentenceModeActive && (
          <SentenceModePanel
            sentences={allSentences}
            currentIdx={sentenceModeIdx}
            language={language}
            onClose={() => { setSentenceModeActive(false); setSentenceModeIdx(0); }}
            onNext={() => setSentenceModeIdx(i => Math.min(i + 1, allSentences.length - 1))}
            onPrev={() => setSentenceModeIdx(i => Math.max(i - 1, 0))}
          />
        )}
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  centeredContainer: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  fullContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  backButton: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    padding: spacing.xs,
  },
  backText: {
    fontSize: fontSize.md,
    color: colors.text,
  },
  screenTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.lg,
  },
  bookCard: {
    alignItems: 'center',
    backgroundColor: colors.cardBackground,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.md,
    width: '100%',
    maxWidth: 400,
  },
  bookIcon: { fontSize: 40, marginBottom: spacing.xs },
  bookTitle: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  primaryButtonText: { color: '#fff', fontSize: fontSize.xs, fontWeight: '600' },
  secondaryButton: {
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
  },
  secondaryButtonText: { color: colors.primary, fontSize: fontSize.xs, fontWeight: '500' },
  errorText: { color: colors.wrong, fontSize: 14, textAlign: 'center', marginTop: spacing.sm },
  loadingText: { color: colors.muted, fontSize: fontSize.xs, marginTop: spacing.sm },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.cardBackground,
  },
  headerBack: { padding: spacing.xs, marginRight: spacing.xs },
  headerBackText: { fontSize: fontSize.md, color: colors.text },
  headerTitle: {
    flex: 1,
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.text,
  },
  headerRight: { width: 36 },
  chapterCounter: { fontSize: 13, color: colors.muted, marginLeft: spacing.xs },

  // TOC
  tocItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.cardBackground,
  },
  tocItemText: {
    flex: 1,
    fontSize: fontSize.xs,
    color: colors.text,
    fontWeight: '500',
  },
  tocItemSubText: {
    fontWeight: '400',
    color: colors.muted,
    fontSize: 15,
  },
  tocChevron: { fontSize: fontSize.md, color: colors.muted, marginLeft: spacing.xs },
  separator: { height: 1, backgroundColor: colors.border },

  // Chapter navigation
  chapterNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.cardBackground,
  },
  navButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  navButtonDisabled: { opacity: 0.3 },
  navButtonText: { color: colors.primary, fontSize: fontSize.xs, fontWeight: '500' },
});
