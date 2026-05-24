import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView,
  FlatList, NativeSyntheticEvent, NativeScrollEvent,
  ListRenderItemInfo, useWindowDimensions,
} from 'react-native';
import RNFS from 'react-native-fs';
import { createSound } from 'react-native-nitro-sound';
import { speak, translateSentence } from '../api/client';
import type { SentenceChunk, SentenceWord } from '../api/client';
import { cleanWord } from '../utils/epubParser';
import type { Sentence } from '../utils/epubParser';
import { colors, spacing, fontSize, borderRadius } from '../styles/theme';
import type { Language } from '../types';

type Sound = ReturnType<typeof createSound>;

export interface SentencePageData {
  sentence: Sentence;
  chapterIdx: number;
  chapterTitle: string;
  sentenceIdxInChapter: number;
  totalSentencesInChapter: number;
}

interface Props {
  pages: SentencePageData[];
  initialIndex: number;
  totalChapters: number;
  language: Language;
  bookTitle: string | null;
  bookAuthor: string | null;
  onPageChange?: (idx: number, page: SentencePageData) => void;
  onBack: () => void;
}

/**
 * Book-wide reader. Every sentence across every chapter is one flat list of
 * pages — swipe just works across chapter boundaries with no special edge
 * handling. The header re-reads the current page's chapter metadata on each
 * settled swipe so the reader always sees where they are.
 */
export function SentenceModePanel({
  pages, initialIndex, totalChapters, language, bookTitle, bookAuthor, onPageChange, onBack,
}: Props) {
  const { width } = useWindowDimensions();
  const listRef = useRef<FlatList<SentencePageData>>(null);
  const [currentIdx, setCurrentIdx] = useState(initialIndex);

  // When the parent updates initialIndex (e.g. TOC tap), scroll-jump to it.
  // Bare initialScrollIndex only applies on first mount.
  useEffect(() => {
    setCurrentIdx(initialIndex);
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: initialIndex * width, animated: false });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialIndex, width]);

  const onMomentumEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / width);
    if (idx !== currentIdx && pages[idx]) {
      setCurrentIdx(idx);
      onPageChange?.(idx, pages[idx]);
    }
  }, [width, currentIdx, onPageChange, pages]);

  const getItemLayout = useCallback(
    (_data: ArrayLike<SentencePageData> | null | undefined, index: number) => ({
      length: width, offset: width * index, index,
    }),
    [width],
  );

  const current = pages[currentIdx] ?? pages[0];

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerBtn} onPress={onBack}>
          <Text style={styles.headerBtnText}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          {bookTitle ? (
            <Text style={styles.headerBookLine} numberOfLines={1}>
              {bookTitle}{bookAuthor ? ` · ${bookAuthor}` : ''}
            </Text>
          ) : null}
          <Text style={styles.headerTitle} numberOfLines={1}>{current?.chapterTitle ?? ''}</Text>
          <Text style={styles.headerCounter}>
            Ch {(current?.chapterIdx ?? 0) + 1}/{totalChapters} · {(current?.sentenceIdxInChapter ?? 0) + 1}/{current?.totalSentencesInChapter ?? 0}
          </Text>
        </View>
        <View style={styles.headerBtn} />
      </View>

      {/* Pages */}
      <FlatList
        ref={listRef}
        data={pages}
        keyExtractor={p => `${p.chapterIdx}:${p.sentence.id}`}
        renderItem={({ item }: ListRenderItemInfo<SentencePageData>) => (
          <SentencePage sentence={item.sentence} language={language} width={width} />
        )}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={width}
        snapToAlignment="start"
        initialScrollIndex={Math.min(initialIndex, Math.max(0, pages.length - 1))}
        getItemLayout={getItemLayout}
        onMomentumScrollEnd={onMomentumEnd}
        windowSize={3}
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        removeClippedSubviews
      />
    </View>
  );
}

// ── Single page ─────────────────────────────────────────────────────────────

function SentencePage({ sentence, language, width }: { sentence: Sentence; language: Language; width: number }) {
  const [chunks, setChunks] = useState<SentenceChunk[]>([]);
  const [contentWords, setContentWords] = useState<SentenceWord[]>([]);
  const [translating, setTranslating] = useState(false);
  const [selectedWord, setSelectedWord] = useState<SentenceWord | null>(null);
  const [playingChunkIdx, setPlayingChunkIdx] = useState<number | null>(null);
  const soundRef = useRef<Sound | null>(null);

  const contentLookup = useMemo(() => {
    const m = new Map<string, SentenceWord>();
    for (const w of contentWords) {
      const key = cleanWord(w.word).toLowerCase();
      if (key && !m.has(key)) m.set(key, w);
    }
    return m;
  }, [contentWords]);

  useEffect(() => {
    let cancelled = false;
    setSelectedWord(null);
    setChunks([]);
    setContentWords([]);
    setTranslating(true);

    translateSentence(sentence.raw, language)
      .then(res => {
        if (cancelled) return;
        setChunks(res.chunks?.length ? res.chunks : [{ original: sentence.raw, translation: res.translation || '—' }]);
        setContentWords(res.words || []);
      })
      .catch(err => {
        console.log('[SentencePage] translateSentence error', err?.message);
        if (!cancelled) {
          setChunks([{ original: sentence.raw, translation: '—' }]);
          setContentWords([]);
        }
      })
      .finally(() => { if (!cancelled) setTranslating(false); });

    return () => { cancelled = true; stopAudio(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentence.id, language]);

  useEffect(() => () => { stopAudio(); }, []);

  async function stopAudio() {
    if (soundRef.current) {
      try { await soundRef.current.stopPlayer(); } catch {}
      try { soundRef.current.dispose(); } catch {}
      soundRef.current = null;
    }
  }

  async function playChunkAudio(text: string, idx: number) {
    await stopAudio();
    setPlayingChunkIdx(idx);
    try {
      const base64 = await speak(text, language);
      const key = text.slice(0, 40).replace(/[^a-zA-Z0-9]/g, '_');
      const path = `${RNFS.CachesDirectoryPath}/chunk_${language}_${key}.mp3`;
      await RNFS.writeFile(path, base64, 'base64');

      const sound = createSound();
      soundRef.current = sound;

      await new Promise<void>(resolve => {
        sound.addPlaybackEndListener(() => {
          sound.removePlaybackEndListener();
          try { sound.stopPlayer().catch(() => {}); } catch {}
          try { sound.dispose(); } catch {}
          soundRef.current = null;
          resolve();
        });
        sound.startPlayer(path).catch(() => {
          sound.removePlaybackEndListener();
          try { sound.dispose(); } catch {}
          soundRef.current = null;
          resolve();
        });
      });
    } catch {
      // TTS unavailable for this text — skip silently
    } finally {
      setPlayingChunkIdx(prev => (prev === idx ? null : prev));
    }
  }

  function handleWordTap(rawWord: string) {
    const entry = contentLookup.get(cleanWord(rawWord).toLowerCase());
    if (entry) setSelectedWord(entry);
  }

  function tokenizeChunk(text: string): string[] {
    return text.split(/(\s+)/).filter(p => p.length > 0);
  }

  return (
    <View style={{ width }}>
      <ScrollView contentContainerStyle={styles.pageBody} showsVerticalScrollIndicator={false}>
        {translating ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : (
          chunks.map((chunk, idx) => {
            const isPlaying = playingChunkIdx === idx;
            return (
              <View key={idx} style={styles.chunk}>
                <Text style={styles.chunkTranslation}>{chunk.translation || '—'}</Text>
                <View style={styles.chunkRow}>
                  <Text style={styles.chunkOriginal}>
                    {tokenizeChunk(chunk.original).map((tok, i) => {
                      if (/^\s+$/.test(tok)) {
                        return <Text key={i} style={styles.nonContent}>{tok}</Text>;
                      }
                      const clean = cleanWord(tok).toLowerCase();
                      const entry = clean ? contentLookup.get(clean) : undefined;
                      if (!entry) {
                        return <Text key={i} style={styles.nonContent}>{tok}</Text>;
                      }
                      const isActive = selectedWord
                        && cleanWord(selectedWord.word).toLowerCase() === clean;
                      return (
                        <Text
                          key={i}
                          onPress={() => handleWordTap(tok)}
                          style={[styles.contentWord, isActive && styles.contentWordActive]}
                        >
                          {tok}
                        </Text>
                      );
                    })}
                  </Text>
                  <TouchableOpacity
                    style={styles.chunkPlayBtn}
                    onPress={() => playChunkAudio(chunk.original, idx)}
                    disabled={isPlaying}
                  >
                    <Text style={styles.chunkPlayBtnText}>{isPlaying ? '⌛' : '🔊'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}

        {selectedWord && (
          <View style={styles.wordCard}>
            <View style={styles.wordCardHeader}>
              <Text style={styles.wordCardWord}>{selectedWord.word}</Text>
              <Text style={styles.wordCardPos}>{selectedWord.pos}</Text>
            </View>
            <Text style={styles.wordCardTranslation}>{selectedWord.translation || '—'}</Text>
            {selectedWord.explanation ? (
              <Text style={styles.wordCardExplanation}>{selectedWord.explanation}</Text>
            ) : null}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.cardBackground,
  },
  headerBtn: { padding: spacing.xs, minWidth: 36, alignItems: 'center' },
  headerBtnText: { fontSize: fontSize.md, color: colors.text },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerBookLine: { fontSize: 11, color: colors.muted, marginBottom: 2 },
  headerTitle: { fontSize: fontSize.xs, fontWeight: '600', color: colors.text },
  headerCounter: { fontSize: 12, color: colors.muted, marginTop: 2 },

  pageBody: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl,
    flexGrow: 1,
  },
  loader: { marginVertical: spacing.lg },

  chunk: {
    marginBottom: spacing.lg,
  },
  chunkTranslation: {
    fontSize: fontSize.md,
    color: colors.text,
    fontWeight: '500',
    lineHeight: fontSize.md * 1.4,
    marginBottom: 6,
  },
  chunkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  chunkOriginal: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.muted,
    lineHeight: fontSize.sm * 1.65,
  },
  chunkPlayBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginTop: 2,
    opacity: 0.7,
  },
  chunkPlayBtnText: { fontSize: fontSize.sm },

  nonContent: { color: colors.muted },
  contentWord: {
    color: colors.text,
    fontWeight: '600',
    textDecorationLine: 'underline',
    textDecorationColor: colors.border,
  },
  contentWordActive: {
    color: colors.primary,
    backgroundColor: '#dbeafe',
    borderRadius: 2,
  },

  wordCard: {
    marginTop: spacing.lg,
    backgroundColor: colors.cardBackground,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 6,
  },
  wordCardHeader: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  wordCardWord: { fontSize: fontSize.sm, color: colors.text, fontWeight: '700' },
  wordCardPos: { fontSize: 12, color: colors.muted, textTransform: 'uppercase' },
  wordCardTranslation: { fontSize: fontSize.xs, color: colors.text, fontWeight: '500' },
  wordCardExplanation: { fontSize: 13, color: colors.muted, lineHeight: 18 },
});
