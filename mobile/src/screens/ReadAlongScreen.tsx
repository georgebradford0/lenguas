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
  getState, setCurrentBookHash, setPosition,
} from '../utils/bookStorage';
import { SentenceModePanel } from '../components/SentenceModePanel';
import type { EpubHandle, TocEntry, Chapter, Sentence } from '../utils/epubParser';
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
  const [currentChapter, setCurrentChapter] = useState<Chapter | null>(null);
  const [currentTocIdx, setCurrentTocIdx] = useState(0);
  const [sentenceIdx, setSentenceIdx] = useState(0);

  // ── Init: hydrate from cache or download, then jump to saved chapter ───────

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

        const state = await getState(language);
        await setCurrentBookHash(language, contentHash);

        const handle = hydrateSerializedBook(stored);
        epubRef.current = handle;
        setEpubTitle(handle.title);
        setEpubAuthor(handle.author);
        setToc(handle.toc);

        const tocIdx = state.positions[contentHash] ?? 0;
        openChapter(tocIdx);
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
    setPosition(language, contentHash, tocIdx).catch(() => {});
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
          <TouchableOpacity style={styles.headerBack} onPress={() => currentChapter ? setPhase('reading') : onBack()}>
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
