import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  FlatList, ListRenderItemInfo, Modal,
} from 'react-native';
import { colors, spacing, fontSize, borderRadius } from '../styles/theme';
import { hydrateSerializedBook } from '../utils/epubParser';
import { fetchBook } from '../api/client';
import type { LibrarySummary } from '../api/client';
import {
  cacheBook, loadCachedBook,
  getPosition, setPosition,
  getReaderMode, setReaderMode,
} from '../utils/bookStorage';
import type { ReaderMode } from '../utils/bookStorage';
import { ChapterReader } from '../components/SentenceModePanel';
import type { EpubHandle, TocEntry } from '../utils/epubParser';
import type { Language } from '../types';

type Phase = 'loading' | 'downloading' | 'reading';

export function ReadAlongScreen({ book, onBack }: { book: LibrarySummary; onBack: () => void }) {
  const language = book.language as Language;
  const contentHash = book.contentHash;

  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [tocVisible, setTocVisible] = useState(false);

  const epubRef = useRef<EpubHandle | null>(null);
  const [epubTitle, setEpubTitle] = useState<string | null>(null);
  const [epubAuthor, setEpubAuthor] = useState<string | null>(null);
  const [toc, setToc] = useState<TocEntry[]>([]);

  // Reader is per-section: one chapter rendered as continuous scroll. We track
  // which chapter is open and which sentence within it to resume at.
  const [currentChapterIdx, setCurrentChapterIdx] = useState(0);
  const [initialSentenceIdx, setInitialSentenceIdx] = useState(0);
  const [readerMode, setReaderModeState] = useState<ReaderMode>('scroll');

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

        const handle = hydrateSerializedBook(stored);
        epubRef.current = handle;
        setEpubTitle(handle.title);
        setEpubAuthor(handle.author);
        setToc(handle.toc);

        const [saved, mode] = await Promise.all([
          getPosition(language, contentHash),
          getReaderMode(),
        ]);
        const safeChapter = Math.min(Math.max(0, saved.chapterIdx), handle.toc.length - 1);
        const safeSentence = Math.max(0, saved.sentenceIdx);
        if (cancelled) return;
        setReaderModeState(mode);
        setCurrentChapterIdx(safeChapter);
        setInitialSentenceIdx(safeSentence);
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
    if (!epubRef.current?.toc[tocIdx]) return;
    setTocVisible(false);
    setCurrentChapterIdx(tocIdx);
    setInitialSentenceIdx(0);
    setPhase('reading');
    // Persist intent in case the user backgrounds before scrolling.
    setPosition(language, contentHash, { chapterIdx: tocIdx, sentenceIdx: 0 }).catch(() => {});
  }

  function handleSentenceChange(sentenceIdx: number) {
    setPosition(language, contentHash, {
      chapterIdx: currentChapterIdx,
      sentenceIdx,
    }).catch(() => {});
  }

  function handleModeChange(mode: ReaderMode) {
    setReaderModeState(mode);
    setReaderMode(mode).catch(() => {});
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

  // ── Reading: one chapter as a continuous vertical scroll ────────────────────

  if (phase === 'reading') {
    const handle = epubRef.current;
    const entry = handle?.toc[currentChapterIdx];
    const chapter = entry ? handle?.chapters[entry.href] : undefined;
    const paragraphs = chapter?.paragraphs ?? [];

    const tocModal = (
      <TocModal
        visible={tocVisible}
        toc={toc}
        currentChapterIdx={currentChapterIdx}
        onSelect={openChapter}
        onClose={() => setTocVisible(false)}
      />
    );

    if (!entry || paragraphs.length === 0) {
      return (
        <View style={styles.centeredContainer}>
          <Text style={styles.loadingText}>No text in this section.</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={() => setTocVisible(true)}>
            <Text style={styles.primaryButtonText}>Open contents</Text>
          </TouchableOpacity>
          {tocModal}
        </View>
      );
    }
    return (
      <>
        <ChapterReader
          key={currentChapterIdx}
          paragraphs={paragraphs}
          chapterTitle={entry.title}
          chapterIdx={currentChapterIdx}
          totalChapters={toc.length}
          language={language}
          bookTitle={epubTitle}
          bookAuthor={epubAuthor}
          initialSentenceIdx={initialSentenceIdx}
          onSentenceChange={handleSentenceChange}
          initialMode={readerMode}
          onModeChange={handleModeChange}
          onBack={onBack}
          onOpenToc={() => setTocVisible(true)}
        />
        {tocModal}
      </>
    );
  }

  return null;
}

// ── Table of contents: bottom-sheet modal that slides up from the bottom ──────

function TocModal({
  visible, toc, currentChapterIdx, onSelect, onClose,
}: {
  visible: boolean;
  toc: TocEntry[];
  currentChapterIdx: number;
  onSelect: (index: number) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.modalRoot}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={onClose} />
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Contents</Text>
            <TouchableOpacity
              style={styles.modalClose}
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.modalCloseText}>×</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={toc}
            keyExtractor={e => e.id}
            renderItem={({ item, index }: ListRenderItemInfo<TocEntry>) => {
              const isCurrent = index === currentChapterIdx;
              return (
                <TouchableOpacity
                  style={[styles.tocItem, item.level > 0 && { paddingLeft: spacing.md + item.level * 16 }]}
                  onPress={() => onSelect(index)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.tocItemText,
                      item.level > 0 && styles.tocItemSubText,
                      isCurrent && styles.tocItemTextActive,
                    ]}
                    numberOfLines={2}
                  >
                    {item.title}
                  </Text>
                  <Text style={styles.tocChevron}>{isCurrent ? '●' : '›'}</Text>
                </TouchableOpacity>
              );
            }}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            contentContainerStyle={{ paddingBottom: spacing.xl }}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  centeredContainer: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
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

  // TOC bottom-sheet modal
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  modalSheet: {
    maxHeight: '80%',
    backgroundColor: colors.background,
    borderTopLeftRadius: borderRadius.lg,
    borderTopRightRadius: borderRadius.lg,
    paddingTop: spacing.xs,
    overflow: 'hidden',
  },
  modalHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: { fontSize: fontSize.xs, fontWeight: '700', color: colors.text },
  modalClose: { paddingHorizontal: 4, paddingVertical: 2 },
  modalCloseText: { fontSize: fontSize.md, color: colors.muted, lineHeight: fontSize.md },

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
  tocItemTextActive: { color: colors.primary, fontWeight: '700' },
  tocChevron: { fontSize: fontSize.md, color: colors.muted, marginLeft: spacing.xs },
  separator: { height: 1, backgroundColor: colors.border },
});
