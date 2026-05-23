import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  FlatList, ListRenderItemInfo,
} from 'react-native';
import { colors, spacing, fontSize, borderRadius } from '../styles/theme';
import { hydrateSerializedBook } from '../utils/epubParser';
import { listLibrary, fetchBook } from '../api/client';
import type { LibrarySummary } from '../api/client';
import {
  cacheBook, loadCachedBook, hasCachedBook,
  cacheLibraryList, loadCachedLibraryList,
  getState, setCurrentBookHash, setPosition,
} from '../utils/bookStorage';
import { SentenceModePanel } from '../components/SentenceModePanel';
import type { EpubHandle, TocEntry, Chapter, Sentence, SerializedBook } from '../utils/epubParser';
import type { Language } from '../types';

type Phase = 'loading' | 'library' | 'downloading' | 'toc' | 'reading';

export function ReadAlongScreen({ language, onBack }: { language: Language; onBack: () => void }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [library, setLibrary] = useState<LibrarySummary[]>([]);
  const [downloadedHashes, setDownloadedHashes] = useState<Set<string>>(new Set());
  const [downloadingHash, setDownloadingHash] = useState<string | null>(null);

  const epubRef = useRef<EpubHandle | null>(null);
  const [currentHash, setCurrentHash] = useState<string | null>(null);
  const [epubTitle, setEpubTitle] = useState<string | null>(null);
  const [epubAuthor, setEpubAuthor] = useState<string | null>(null);
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [currentChapter, setCurrentChapter] = useState<Chapter | null>(null);
  const [currentTocIdx, setCurrentTocIdx] = useState(0);
  const [sentenceIdx, setSentenceIdx] = useState(0);

  // ── Init: fetch library + auto-resume ───────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const state = await getState(language);

        // Server library, fall back to cached list when offline.
        let books: LibrarySummary[];
        try {
          books = await listLibrary(language);
          await cacheLibraryList(language, books);
        } catch (e) {
          console.warn('[ReadAlong] library fetch failed, using cache:', (e as any)?.message);
          books = (await loadCachedLibraryList(language)) ?? [];
        }
        if (cancelled) return;
        setLibrary(books);

        const downloaded = new Set<string>();
        for (const b of books) {
          if (await hasCachedBook(b.contentHash)) downloaded.add(b.contentHash);
        }
        if (cancelled) return;
        setDownloadedHashes(downloaded);

        if (state.currentBookHash && downloaded.has(state.currentBookHash)) {
          const stored = await loadCachedBook(state.currentBookHash);
          if (stored && !cancelled) {
            openBook(state.currentBookHash, stored, state.positions[state.currentBookHash] ?? 0);
            return;
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
    try {
      const books = await listLibrary(language);
      await cacheLibraryList(language, books);
      setLibrary(books);
      const downloaded = new Set<string>();
      for (const b of books) {
        if (await hasCachedBook(b.contentHash)) downloaded.add(b.contentHash);
      }
      setDownloadedHashes(downloaded);
    } catch (e) {
      console.warn('[ReadAlong] refresh failed:', (e as any)?.message);
    }
  }

  // ── Open a library book (downloading first if needed) ──────────────────────

  async function handleOpenLibraryBook(summary: LibrarySummary) {
    try {
      setError(null);
      let book = await loadCachedBook(summary.contentHash);
      if (!book) {
        setDownloadingHash(summary.contentHash);
        setPhase('downloading');
        book = await fetchBook(summary.contentHash);
        await cacheBook(summary.contentHash, book);
        setDownloadedHashes(prev => new Set(prev).add(summary.contentHash));
        setDownloadingHash(null);
      }
      const state = await getState(language);
      const tocIdx = state.positions[summary.contentHash] ?? 0;
      await setCurrentBookHash(language, summary.contentHash);
      openBook(summary.contentHash, book, tocIdx);
    } catch (e: any) {
      setError(e?.message || 'Failed to open book.');
      setDownloadingHash(null);
      setPhase('library');
    }
  }

  function openBook(contentHash: string, book: SerializedBook, tocIdx: number) {
    const handle = hydrateSerializedBook(book);
    epubRef.current = handle;
    setCurrentHash(contentHash);
    setEpubTitle(handle.title);
    setEpubAuthor(handle.author);
    setToc(handle.toc);
    openChapter(tocIdx);
  }

  async function handleCloseCurrentBook() {
    await setCurrentBookHash(language, null);
    epubRef.current = null;
    setCurrentHash(null);
    setEpubTitle(null);
    setEpubAuthor(null);
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
    if (currentHash) setPosition(language, currentHash, tocIdx).catch(() => {});
  }

  // ── Rendering ────────────────────────────────────────────────────────────────

  if (phase === 'loading') {
    return (
      <View style={styles.centeredContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (phase === 'downloading') {
    const downloading = library.find(b => b.contentHash === downloadingHash);
    return (
      <View style={styles.centeredContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Downloading{downloading ? ` "${downloading.title}"` : ''}…</Text>
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
          <Text style={styles.headerTitle}>Library</Text>
          <TouchableOpacity style={styles.headerLibraryButton} onPress={refreshLibrary}>
            <Text style={styles.headerLibraryText}>Refresh</Text>
          </TouchableOpacity>
        </View>

        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {library.length === 0 ? (
          <View style={styles.libraryEmpty}>
            <Text style={styles.libraryEmptyIcon}>📚</Text>
            <Text style={styles.libraryEmptyText}>
              No books in the {language.toUpperCase()} library yet.{'\n'}
              Run the parse CLI to add some.
            </Text>
          </View>
        ) : (
          <FlatList
            data={library}
            keyExtractor={b => b.contentHash}
            renderItem={({ item }: ListRenderItemInfo<LibrarySummary>) => {
              const isDownloaded = downloadedHashes.has(item.contentHash);
              return (
                <TouchableOpacity
                  style={styles.libraryRow}
                  onPress={() => handleOpenLibraryBook(item)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.libraryRowIcon}>{isDownloaded ? '📖' : '☁️'}</Text>
                  <View style={styles.libraryRowText}>
                    <Text style={styles.libraryRowTitle} numberOfLines={2}>{item.title}</Text>
                    {item.author ? (
                      <Text style={styles.libraryRowAuthor} numberOfLines={1}>{item.author}</Text>
                    ) : null}
                  </View>
                  {item.difficulty ? (
                    <Text style={styles.libraryRowBadge}>{item.difficulty}</Text>
                  ) : null}
                </TouchableOpacity>
              );
            }}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            contentContainerStyle={{ paddingBottom: spacing.xl }}
          />
        )}
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
          <View style={styles.headerTitleStack}>
            <Text style={styles.headerTitle} numberOfLines={1}>{epubTitle}</Text>
            {epubAuthor ? (
              <Text style={styles.headerSubtitle} numberOfLines={1}>{epubAuthor}</Text>
            ) : null}
          </View>
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
        bookTitle={epubTitle}
        bookAuthor={epubAuthor}
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
  errorBanner: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  errorText: { color: colors.wrong, fontSize: 14, textAlign: 'center' },
  loadingText: { color: colors.muted, fontSize: fontSize.xs, marginTop: spacing.sm, textAlign: 'center' },

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
  headerTitleStack: { flex: 1 },
  headerTitle: {
    flex: 1,
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.text,
  },
  headerSubtitle: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 1,
  },
  headerLibraryButton: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  headerLibraryText: { color: colors.primary, fontSize: 13, fontWeight: '600' },

  // Library
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
  libraryRowIcon: { fontSize: 22, marginRight: spacing.sm },
  libraryRowText: {
    flex: 1,
  },
  libraryRowTitle: {
    fontSize: fontSize.xs,
    color: colors.text,
    fontWeight: '500',
  },
  libraryRowAuthor: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 2,
  },
  libraryRowBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: spacing.xs,
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
