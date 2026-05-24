import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  FlatList, ListRenderItemInfo,
} from 'react-native';
import { colors, spacing, fontSize, borderRadius } from '../styles/theme';
import { hydrateSerializedBook } from '../utils/epubParser';
import { fetchBook } from '../api/client';
import type { LibrarySummary } from '../api/client';
import {
  cacheBook, loadCachedBook,
  getPosition, setCurrentBookHash, setPosition,
} from '../utils/bookStorage';
import { SentenceModePanel } from '../components/SentenceModePanel';
import type { SentencePageData } from '../components/SentenceModePanel';
import type { EpubHandle, TocEntry } from '../utils/epubParser';
import type { Language } from '../types';

type Phase = 'loading' | 'downloading' | 'toc' | 'reading';

export function ReadAlongScreen({ book, onBack }: { book: LibrarySummary; onBack: () => void }) {
  const language = book.language as Language;
  const contentHash = book.contentHash;

  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);

  const epubRef = useRef<EpubHandle | null>(null);
  const [epubTitle, setEpubTitle] = useState<string | null>(null);
  const [epubAuthor, setEpubAuthor] = useState<string | null>(null);
  const [toc, setToc] = useState<TocEntry[]>([]);

  // Whole-book flat pages. Built once after hydrate; cross-chapter swipe is
  // free because the entire book is one paged FlatList.
  const [pages, setPages] = useState<SentencePageData[]>([]);
  const chapterStartsRef = useRef<number[]>([]); // chapterIdx → first page index
  const [initialPageIdx, setInitialPageIdx] = useState(0);

  // ── Init: hydrate from cache or download, build pages, jump to saved spot ───

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        let stored = await loadCachedBook(contentHash);
        if (!stored) {
          if (cancelled) return;
          setPhase('downloading');
          stored = await fetchBook(contentHash);
          await cacheBook(contentHash, stored);
        }
        if (cancelled) return;

        await setCurrentBookHash(language, contentHash);

        const handle = hydrateSerializedBook(stored);
        epubRef.current = handle;
        setEpubTitle(handle.title);
        setEpubAuthor(handle.author);
        setToc(handle.toc);

        const { pages: built, starts } = buildPages(handle);
        chapterStartsRef.current = starts;
        setPages(built);

        const saved = await getPosition(language, contentHash);
        const safeChapter = Math.min(Math.max(0, saved.chapterIdx), handle.toc.length - 1);
        const chapterStart = starts[safeChapter] ?? 0;
        const sentencesInChapter = sentenceCountInChapter(starts, built.length, safeChapter);
        const safeSentence = Math.min(Math.max(0, saved.sentenceIdx), Math.max(0, sentencesInChapter - 1));
        if (cancelled) return;
        setInitialPageIdx(chapterStart + safeSentence);
        setPhase('reading');
      } catch (e: any) {
        console.error('[ReadAlong] init failed', e);
        if (!cancelled) {
          setError(e?.message || 'Failed to open book.');
          setPhase('loading');
        }
      }
    })();
    return () => { cancelled = true; };
    // contentHash captures the book identity; language is derived from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentHash]);

  // ── Navigation ───────────────────────────────────────────────────────────────

  function openChapter(tocIdx: number) {
    const start = chapterStartsRef.current[tocIdx];
    if (start === undefined) return;
    setInitialPageIdx(start);
    setPhase('reading');
    // Persist intent in case the user backgrounds before swiping.
    setPosition(language, contentHash, { chapterIdx: tocIdx, sentenceIdx: 0 }).catch(() => {});
  }

  function handlePageChange(_idx: number, page: SentencePageData) {
    setPosition(language, contentHash, {
      chapterIdx: page.chapterIdx,
      sentenceIdx: page.sentenceIdxInChapter,
    }).catch(() => {});
  }

  // ── Rendering ────────────────────────────────────────────────────────────────

  if (phase === 'loading') {
    return (
      <View style={styles.centeredContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {error ? (
          <TouchableOpacity style={styles.primaryButton} onPress={onBack}>
            <Text style={styles.primaryButtonText}>Back to library</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  if (phase === 'downloading') {
    return (
      <View style={styles.centeredContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Downloading "{book.title}"…</Text>
      </View>
    );
  }

  if (phase === 'toc') {
    return (
      <View style={styles.fullContainer}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.headerBack} onPress={() => setPhase('reading')}>
            <Text style={styles.headerBackText}>←</Text>
          </TouchableOpacity>
          <View style={styles.headerTitleStack}>
            <Text style={styles.headerTitle} numberOfLines={1}>{epubTitle}</Text>
            {epubAuthor ? (
              <Text style={styles.headerSubtitle} numberOfLines={1}>{epubAuthor}</Text>
            ) : null}
          </View>
          <TouchableOpacity style={styles.headerLibraryButton} onPress={onBack}>
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

  // ── Reading: horizontal swipe across all sentences in the book ──────────────

  if (phase === 'reading') {
    if (pages.length === 0) {
      return (
        <View style={styles.centeredContainer}>
          <Text style={styles.loadingText}>No sentences in this book.</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={onBack}>
            <Text style={styles.primaryButtonText}>Back to library</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <SentenceModePanel
        pages={pages}
        initialIndex={initialPageIdx}
        totalChapters={toc.length}
        language={language}
        bookTitle={epubTitle}
        bookAuthor={epubAuthor}
        onPageChange={handlePageChange}
        onBack={() => setPhase('toc')}
      />
    );
  }

  return null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function buildPages(handle: EpubHandle): { pages: SentencePageData[]; starts: number[] } {
  const pages: SentencePageData[] = [];
  const starts: number[] = [];
  handle.toc.forEach((entry, chapterIdx) => {
    starts[chapterIdx] = pages.length;
    const chapter = handle.chapters[entry.href];
    if (!chapter) return;
    const sentences = chapter.paragraphs.flatMap(p => p.sentences);
    sentences.forEach((sentence, sentenceIdxInChapter) => {
      pages.push({
        sentence,
        chapterIdx,
        chapterTitle: entry.title,
        sentenceIdxInChapter,
        totalSentencesInChapter: sentences.length,
      });
    });
  });
  return { pages, starts };
}

function sentenceCountInChapter(starts: number[], totalPages: number, chapterIdx: number): number {
  const start = starts[chapterIdx] ?? 0;
  const end = (chapterIdx + 1 < starts.length) ? starts[chapterIdx + 1] : totalPages;
  return Math.max(0, end - start);
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
    marginTop: spacing.md,
  },
  primaryButtonText: { color: '#fff', fontSize: fontSize.xs, fontWeight: '600' },
  errorText: { color: colors.wrong, fontSize: 14, textAlign: 'center', marginTop: spacing.sm },
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
