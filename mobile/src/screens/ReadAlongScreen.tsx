import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  FlatList, Platform, ListRenderItemInfo, Alert,
} from 'react-native';
import { pick, keepLocalCopy, isErrorWithCode, errorCodes } from '@react-native-documents/picker';
import { colors, spacing, fontSize, borderRadius } from '../styles/theme';
import { parseEpub, serializeEpubHandle, hydrateSerializedBook } from '../utils/epubParser';
import {
  saveBook, loadBook, listBooks, deleteBook,
  getState, setCurrentBook, setPosition,
} from '../utils/bookStorage';
import type { BookSummary } from '../utils/bookStorage';
import { EpubReader } from '../components/EpubReader';
import { TranslationCard } from '../components/TranslationCard';
import { WordContextMenu } from '../components/WordContextMenu';
import { SentenceModePanel, PANEL_HEIGHT } from '../components/SentenceModePanel';
import type { EpubHandle, TocEntry, Chapter, Sentence } from '../utils/epubParser';
import type { Language } from '../types';

type Phase = 'loading' | 'library' | 'parsing' | 'toc' | 'reading';

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
  const [phase, setPhase] = useState<Phase>('loading');
  const [parseProgress, setParseProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const epubRef = useRef<EpubHandle | null>(null);
  const [epubTitle, setEpubTitle] = useState<string | null>(null);
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [library, setLibrary] = useState<BookSummary[]>([]);
  const [currentChapter, setCurrentChapter] = useState<Chapter | null>(null);
  const [currentTocIdx, setCurrentTocIdx] = useState(0);
  const [selected, setSelected] = useState<SelectedWord | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false, wordId: '', word: '', sentence: null,
  });
  const [sentenceModeActive, setSentenceModeActive] = useState(false);
  const [sentenceModeIdx, setSentenceModeIdx] = useState(0);

  // ── Init: load library + auto-resume current book ────────────────────────────

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [state, books] = await Promise.all([getState(language), listBooks(language)]);
        if (cancelled) return;
        setLibrary(books);
        if (state.currentBookId) {
          const stored = await loadBook(state.currentBookId);
          if (stored && !cancelled) {
            const handle = hydrateSerializedBook(stored);
            epubRef.current = handle;
            setEpubTitle(handle.title);
            setToc(handle.toc);
            const tocIdx = state.positions[stored.id] ?? 0;
            const entry = handle.toc[tocIdx];
            const chapter = entry ? handle.chapters[entry.href] : undefined;
            if (chapter) {
              setCurrentChapter(chapter);
              setCurrentTocIdx(tocIdx);
              setPhase('reading');
              return;
            }
          }
        }
        setPhase('library');
      } catch (e) {
        console.error('[ReadAlong] init failed', e);
        if (!cancelled) setPhase('library');
      }
    })();
    return () => { cancelled = true; };
  }, [language]);

  async function refreshLibrary() {
    const books = await listBooks(language);
    setLibrary(books);
  }

  // ── File picker ─────────────────────────────────────────────────────────────

  async function handleSelectEpub() {
    try {
      setError(null);
      const [result] = await pick({
        type: Platform.OS === 'ios' ? 'org.idpf.epub-container' : 'application/epub+zip',
      });

      setPhase('parsing');
      setParseProgress(null);
      const copies = await keepLocalCopy({
        files: [{ uri: result.uri, fileName: result.name ?? 'book.epub' }],
        destination: 'cachesDirectory',
      });
      const copy = copies[0];
      if (copy.status !== 'success') throw new Error('Failed to copy file');

      const handle = await parseEpub(copy.localUri, (done, total) => {
        setParseProgress({ done, total });
      });
      epubRef.current = handle;
      setEpubTitle(handle.title);
      setToc(handle.toc);
      setSelected(null);

      // Persist parsed book + mark as current
      try {
        await saveBook(serializeEpubHandle(handle));
        await setCurrentBook(language, handle.id);
        await refreshLibrary();
      } catch (e) {
        console.error('[ReadAlong] failed to persist book', e);
      }

      // Open at chapter 0 (or saved position if reopening the same book)
      const state = await getState(language);
      const tocIdx = state.positions[handle.id] ?? 0;
      openChapter(tocIdx);
    } catch (e: any) {
      if (!isErrorWithCode(e) || e.code !== errorCodes.OPERATION_CANCELED) {
        setError('Failed to open epub.');
        console.error(e);
      }
      setPhase(epubRef.current ? 'reading' : 'library');
    }
  }

  // ── Open a saved book from the library ──────────────────────────────────────

  async function handleOpenSavedBook(summary: BookSummary) {
    try {
      setError(null);
      setPhase('parsing');
      setParseProgress(null);
      const stored = await loadBook(summary.id);
      if (!stored) {
        await deleteBook(summary.id, language);
        await refreshLibrary();
        setError('Saved book is missing or corrupt — removed from library.');
        setPhase('library');
        return;
      }
      const handle = hydrateSerializedBook(stored);
      epubRef.current = handle;
      setEpubTitle(handle.title);
      setToc(handle.toc);
      setSelected(null);
      await setCurrentBook(language, handle.id);
      const state = await getState(language);
      const tocIdx = state.positions[handle.id] ?? 0;
      openChapter(tocIdx);
    } catch (e) {
      console.error('[ReadAlong] failed to open saved book', e);
      setError('Failed to open saved book.');
      setPhase('library');
    }
  }

  function handleDeleteBook(summary: BookSummary) {
    Alert.alert(
      'Delete Book',
      `Remove "${summary.title}" from your library?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteBook(summary.id, language);
            await refreshLibrary();
          },
        },
      ],
    );
  }

  async function handleCloseCurrentBook() {
    await setCurrentBook(language, null);
    epubRef.current = null;
    setEpubTitle(null);
    setToc([]);
    setCurrentChapter(null);
    setCurrentTocIdx(0);
    setSelected(null);
    setSentenceModeActive(false);
    await refreshLibrary();
    setPhase('library');
  }

  // ── Chapter loading ──────────────────────────────────────────────────────────

  function openChapter(tocIdx: number) {
    const handle = epubRef.current;
    if (!handle) return;
    const entry = handle.toc[tocIdx];
    if (!entry) return;
    const chapter = handle.chapters[entry.href];
    if (!chapter) { setError('Chapter not available.'); return; }
    setSelected(null);
    setCurrentChapter(chapter);
    setCurrentTocIdx(tocIdx);
    setPhase('reading');
    setPosition(language, handle.id, tocIdx).catch(() => {});
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

  if (phase === 'loading') {
    return (
      <View style={styles.centeredContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (phase === 'library') {
    return (
      <View style={styles.fullContainer}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.headerBack} onPress={onBack}>
            <Text style={styles.headerBackText}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Read Along</Text>
          <View style={styles.headerRight} />
        </View>

        <View style={styles.libraryActions}>
          <TouchableOpacity style={styles.primaryButton} onPress={handleSelectEpub} activeOpacity={0.85}>
            <Text style={styles.primaryButtonText}>+ Add Book</Text>
          </TouchableOpacity>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>

        {library.length === 0 ? (
          <View style={styles.libraryEmpty}>
            <Text style={styles.libraryEmptyIcon}>📚</Text>
            <Text style={styles.libraryEmptyText}>Your library is empty.{'\n'}Add an EPUB to get started.</Text>
          </View>
        ) : (
          <FlatList
            data={library}
            keyExtractor={b => b.id}
            renderItem={({ item }: ListRenderItemInfo<BookSummary>) => (
              <View style={styles.libraryRow}>
                <TouchableOpacity
                  style={styles.libraryRowBody}
                  onPress={() => handleOpenSavedBook(item)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.libraryRowIcon}>📖</Text>
                  <Text style={styles.libraryRowTitle} numberOfLines={2}>{item.title}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.libraryRowDelete}
                  onPress={() => handleDeleteBook(item)}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                  <Text style={styles.libraryRowDeleteText}>✕</Text>
                </TouchableOpacity>
              </View>
            )}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            contentContainerStyle={{ paddingBottom: spacing.xl }}
          />
        )}
      </View>
    );
  }

  if (phase === 'parsing') {
    const progressText = parseProgress
      ? `Parsing chapter ${parseProgress.done} of ${parseProgress.total}…`
      : 'Opening epub…';
    return (
      <View style={styles.centeredContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>{progressText}</Text>
      </View>
    );
  }

  if (phase === 'toc') {
    return (
      <View style={styles.fullContainer}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.headerBack} onPress={() => currentChapter ? setPhase('reading') : handleCloseCurrentBook()}>
            <Text style={styles.headerBackText}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>{epubTitle}</Text>
          <TouchableOpacity style={styles.headerLibraryButton} onPress={handleCloseCurrentBook}>
            <Text style={styles.headerLibraryText}>Library</Text>
          </TouchableOpacity>
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
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#fff', fontSize: fontSize.xs, fontWeight: '600' },
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
  headerLibraryButton: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  headerLibraryText: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  chapterCounter: { fontSize: 13, color: colors.muted, marginLeft: spacing.xs },

  // Library
  libraryActions: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  libraryEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  libraryEmptyIcon: { fontSize: 48, marginBottom: spacing.sm, opacity: 0.6 },
  libraryEmptyText: {
    color: colors.muted,
    fontSize: fontSize.xs,
    textAlign: 'center',
    lineHeight: 22,
  },
  libraryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardBackground,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  libraryRowBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  libraryRowIcon: { fontSize: 22, marginRight: spacing.sm },
  libraryRowTitle: {
    flex: 1,
    fontSize: fontSize.xs,
    color: colors.text,
    fontWeight: '500',
  },
  libraryRowDelete: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  libraryRowDeleteText: {
    fontSize: fontSize.md,
    color: colors.muted,
    fontWeight: '300',
  },

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
