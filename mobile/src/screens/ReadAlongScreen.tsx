import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  FlatList, Platform, ListRenderItemInfo, Alert,
} from 'react-native';
import RNFS from 'react-native-fs';
import { pick, keepLocalCopy, isErrorWithCode, errorCodes } from '@react-native-documents/picker';
import { colors, spacing, fontSize, borderRadius } from '../styles/theme';
import { hydrateSerializedBook } from '../utils/epubParser';
import { parseBookWithLLM } from '../api/client';
import type { BookParseProgress } from '../api/client';
import {
  saveBook, loadBook, listBooks, deleteBook,
  getState, setCurrentBook, setPosition,
} from '../utils/bookStorage';
import type { BookSummary } from '../utils/bookStorage';
import { SentenceModePanel } from '../components/SentenceModePanel';
import type { EpubHandle, TocEntry, Chapter, Sentence } from '../utils/epubParser';
import type { Language } from '../types';

type Phase = 'loading' | 'library' | 'parsing' | 'toc' | 'reading';

function renderProgress(p: BookParseProgress | null): string {
  if (!p) return 'Uploading book…';
  switch (p.phase) {
    case 'extract': return 'Reading EPUB…';
    case 'toc': return 'Identifying chapters…';
    case 'toc-done': return `${p.total ?? 0} chapters found`;
    case 'section': {
      const title = p.title ? ` — ${p.title}` : '';
      return `Section ${p.current ?? 0} of ${p.total ?? 0}${title}`;
    }
    default: return 'Working…';
  }
}

export function ReadAlongScreen({ language, onBack }: { language: Language; onBack: () => void }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [parseProgress, setParseProgress] = useState<BookParseProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const epubRef = useRef<EpubHandle | null>(null);
  const [epubTitle, setEpubTitle] = useState<string | null>(null);
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [library, setLibrary] = useState<BookSummary[]>([]);
  const [currentChapter, setCurrentChapter] = useState<Chapter | null>(null);
  const [currentTocIdx, setCurrentTocIdx] = useState(0);
  const [sentenceIdx, setSentenceIdx] = useState(0);

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
              setSentenceIdx(0);
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

      // Read the raw .epub bytes — server does the unzip + LLM parse.
      const filePath = decodeURIComponent(copy.localUri.replace(/^file:\/\//, ''));
      const epubBase64 = await RNFS.readFile(filePath, 'base64');
      const guessedTitle = (result.name || 'book.epub').replace(/\.epub$/i, '');

      const book = await parseBookWithLLM(epubBase64, language, guessedTitle, p => {
        setParseProgress(p);
      });

      await saveBook(book);
      await setCurrentBook(language, book.id);
      await refreshLibrary();

      const handle = hydrateSerializedBook(book);
      epubRef.current = handle;
      setEpubTitle(handle.title);
      setToc(handle.toc);

      openChapter(0);
    } catch (e: any) {
      if (!isErrorWithCode(e) || e.code !== errorCodes.OPERATION_CANCELED) {
        setError(e.message || 'Failed to open epub.');
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
    setSentenceIdx(0);
    await refreshLibrary();
    setPhase('library');
  }

  // ── Chapter loading ──────────────────────────────────────────────────────────

  function openChapter(tocIdx: number, sentenceStart = 0) {
    const handle = epubRef.current;
    if (!handle) return;
    const entry = handle.toc[tocIdx];
    if (!entry) return;
    const chapter = handle.chapters[entry.href];
    if (!chapter) { setError('Chapter not available.'); return; }
    setCurrentChapter(chapter);
    setCurrentTocIdx(tocIdx);
    setSentenceIdx(sentenceStart);
    setPhase('reading');
    setPosition(language, handle.id, tocIdx).catch(() => {});
  }

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
    const progressText = renderProgress(parseProgress);
    return (
      <View style={styles.centeredContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>{progressText}</Text>
        <Text style={styles.loadingHint}>This can take a few minutes for long books.</Text>
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

  // ── Reading: one sentence at a time, fullscreen ─────────────────────────────

  if (phase === 'reading' && currentChapter) {
    const allSentences: Sentence[] = currentChapter.paragraphs.flatMap(p => p.sentences);
    const current = allSentences[sentenceIdx];

    if (!current) {
      return (
        <View style={styles.centeredContainer}>
          <Text style={styles.loadingText}>No sentences in this chapter.</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={() => setPhase('toc')}>
            <Text style={styles.primaryButtonText}>Back to chapters</Text>
          </TouchableOpacity>
        </View>
      );
    }

    const isFirstChapter = currentTocIdx === 0;
    const isLastChapter = currentTocIdx >= toc.length - 1;
    const canPrev = sentenceIdx > 0 || !isFirstChapter;
    const canNext = sentenceIdx < allSentences.length - 1 || !isLastChapter;

    function handlePrev() {
      if (sentenceIdx > 0) {
        setSentenceIdx(i => i - 1);
        return;
      }
      if (currentTocIdx === 0) return;
      const handle = epubRef.current;
      if (!handle) return;
      const prevEntry = handle.toc[currentTocIdx - 1];
      const prevChapter = prevEntry && handle.chapters[prevEntry.href];
      if (!prevChapter) return;
      const lastIdx = prevChapter.paragraphs.reduce((n, p) => n + p.sentences.length, 0) - 1;
      openChapter(currentTocIdx - 1, Math.max(0, lastIdx));
    }

    function handleNext() {
      if (sentenceIdx < allSentences.length - 1) {
        setSentenceIdx(i => i + 1);
        return;
      }
      if (currentTocIdx >= toc.length - 1) return;
      openChapter(currentTocIdx + 1, 0);
    }

    return (
      <SentenceModePanel
        key={`${currentTocIdx}-${current.id}`}
        sentence={current}
        language={language}
        position={{ current: sentenceIdx + 1, total: allSentences.length }}
        chapterTitle={`${currentChapter.title} · ${currentTocIdx + 1}/${toc.length}`}
        canPrev={canPrev}
        canNext={canNext}
        onPrev={handlePrev}
        onNext={handleNext}
        onBack={() => setPhase('toc')}
      />
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
  loadingText: { color: colors.muted, fontSize: fontSize.xs, marginTop: spacing.sm, textAlign: 'center' },
  loadingHint: { color: colors.muted, fontSize: 12, marginTop: spacing.xs, opacity: 0.7, textAlign: 'center' },

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
});
