import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  FlatList, ListRenderItemInfo, LayoutAnimation, Platform, UIManager,
  ViewToken,
} from 'react-native';
import RNFS from 'react-native-fs';
import { createSound } from 'react-native-nitro-sound';
import { speak, translateSentence } from '../api/client';
import type { SentenceChunk, SentenceWord, SentenceTranslation } from '../api/client';
import { cleanWord } from '../utils/epubParser';
import type { Paragraph, Sentence } from '../utils/epubParser';
import { colors, spacing, fontSize, borderRadius } from '../styles/theme';
import type { Language } from '../types';

type Sound = ReturnType<typeof createSound>;

// LayoutAnimation needs an explicit opt-in on Android.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const SMOOTH = LayoutAnimation.create(
  220,
  LayoutAnimation.Types.easeInEaseOut,
  LayoutAnimation.Properties.opacity,
);

interface Props {
  paragraphs: Paragraph[];
  chapterTitle: string;
  chapterIdx: number;
  totalChapters: number;
  language: Language;
  bookTitle: string | null;
  bookAuthor: string | null;
  /** Sentence index within this chapter to scroll to on open (resume). */
  initialSentenceIdx: number;
  /** Reports the top-most visible sentence index so the parent can persist it. */
  onSentenceChange?: (sentenceIdx: number) => void;
  onBack: () => void;
}

/**
 * Continuous per-section reader. The chapter renders as one vertical scroll of
 * flowing paragraphs in the source language. Tapping a sentence expands an
 * inline translation box directly beneath its paragraph (smoothly animated),
 * showing the chunk-by-chunk translation with noun/verb taps and per-chunk
 * audio. Only one box is open at a time.
 */
export function ChapterReader({
  paragraphs, chapterTitle, chapterIdx, totalChapters, language,
  bookTitle, bookAuthor, initialSentenceIdx, onSentenceChange, onBack,
}: Props) {
  const listRef = useRef<FlatList<Paragraph>>(null);
  const [expandedSentenceId, setExpandedSentenceId] = useState<string | null>(null);

  // Translations are cached for the lifetime of the chapter so re-tapping a
  // sentence (or scrolling back to it) reopens instantly without a refetch.
  const cacheRef = useRef<Map<string, SentenceTranslation>>(new Map());

  // First sentence index of each paragraph — used for resume + position report.
  const paraStarts = useMemo(() => {
    const starts: number[] = [];
    let acc = 0;
    for (const p of paragraphs) { starts.push(acc); acc += p.sentences.length; }
    return starts;
  }, [paragraphs]);

  const initialParaIdx = useMemo(() => {
    let idx = 0;
    for (let i = 0; i < paraStarts.length; i++) {
      if (paraStarts[i] <= initialSentenceIdx) idx = i; else break;
    }
    return idx;
  }, [paraStarts, initialSentenceIdx]);

  // Stable refs for the viewability callback (FlatList forbids changing it).
  const paraStartsRef = useRef(paraStarts);
  paraStartsRef.current = paraStarts;
  const onSentenceChangeRef = useRef(onSentenceChange);
  onSentenceChangeRef.current = onSentenceChange;

  useEffect(() => {
    if (initialParaIdx <= 0) return;
    const t = setTimeout(() => {
      try { listRef.current?.scrollToIndex({ index: initialParaIdx, animated: false }); } catch {}
    }, 0);
    return () => clearTimeout(t);
  }, [initialParaIdx]);

  const toggleSentence = useCallback((id: string) => {
    LayoutAnimation.configureNext(SMOOTH);
    setExpandedSentenceId(prev => (prev === id ? null : id));
  }, []);

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 10 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (!viewableItems.length) return;
    const top = viewableItems[0].index ?? 0;
    onSentenceChangeRef.current?.(paraStartsRef.current[top] ?? 0);
  }).current;

  const renderItem = useCallback(({ item }: ListRenderItemInfo<Paragraph>) => {
    const activeId = item.sentences.some(s => s.id === expandedSentenceId)
      ? expandedSentenceId
      : null;
    return (
      <ParagraphBlock
        paragraph={item}
        activeSentenceId={activeId}
        language={language}
        cacheRef={cacheRef}
        onToggleSentence={toggleSentence}
      />
    );
  }, [expandedSentenceId, language, toggleSentence]);

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
          <Text style={styles.headerTitle} numberOfLines={1}>{chapterTitle}</Text>
          <Text style={styles.headerCounter}>Ch {chapterIdx + 1}/{totalChapters}</Text>
        </View>
        <View style={styles.headerBtn} />
      </View>

      <FlatList
        ref={listRef}
        data={paragraphs}
        keyExtractor={p => p.id}
        renderItem={renderItem}
        extraData={expandedSentenceId}
        contentContainerStyle={styles.readerBody}
        showsVerticalScrollIndicator={false}
        viewabilityConfig={viewabilityConfig}
        onViewableItemsChanged={onViewableItemsChanged}
        onScrollToIndexFailed={info => {
          setTimeout(() => {
            try { listRef.current?.scrollToIndex({ index: info.index, animated: false }); } catch {}
          }, 80);
        }}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={9}
      />
    </View>
  );
}

// ── One paragraph of flowing, tappable sentences ─────────────────────────────

interface ParagraphBlockProps {
  paragraph: Paragraph;
  activeSentenceId: string | null;
  language: Language;
  cacheRef: React.MutableRefObject<Map<string, SentenceTranslation>>;
  onToggleSentence: (id: string) => void;
}

const ParagraphBlock = React.memo(function ParagraphBlock({
  paragraph, activeSentenceId, language, cacheRef, onToggleSentence,
}: ParagraphBlockProps) {
  // A paragraph flows as one Text. When a sentence is expanded we split the
  // paragraph at that sentence so the box sits directly beneath it: the text
  // up to and including the tapped sentence renders as one run, then the box,
  // then the remaining sentences continue below.
  const splitIdx = activeSentenceId
    ? paragraph.sentences.findIndex(s => s.id === activeSentenceId)
    : -1;

  const renderRun = (sentences: Sentence[]) => (
    <Text style={styles.paragraph}>
      {sentences.map((s, i) => (
        <Text
          key={s.id}
          onPress={() => onToggleSentence(s.id)}
          style={s.id === activeSentenceId ? styles.sentenceActive : styles.sentence}
        >
          {(i > 0 ? ' ' : '') + s.raw}
        </Text>
      ))}
    </Text>
  );

  if (splitIdx < 0) {
    return <View style={styles.paragraphWrap}>{renderRun(paragraph.sentences)}</View>;
  }

  const head = paragraph.sentences.slice(0, splitIdx + 1);
  const tail = paragraph.sentences.slice(splitIdx + 1);
  const active = paragraph.sentences[splitIdx];

  return (
    <View style={styles.paragraphWrap}>
      {renderRun(head)}
      <TranslationBox key={active.id} sentence={active} language={language} cacheRef={cacheRef} />
      {tail.length > 0 ? renderRun(tail) : null}
    </View>
  );
});

// ── Inline translation box for one sentence ──────────────────────────────────

function TranslationBox({
  sentence, language, cacheRef,
}: {
  sentence: Sentence;
  language: Language;
  cacheRef: React.MutableRefObject<Map<string, SentenceTranslation>>;
}) {
  const cached = cacheRef.current.get(sentence.id);
  const [chunks, setChunks] = useState<SentenceChunk[]>(cached?.chunks ?? []);
  const [contentWords, setContentWords] = useState<SentenceWord[]>(cached?.words ?? []);
  const [translating, setTranslating] = useState(!cached);
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
    if (cacheRef.current.has(sentence.id)) return; // already have it
    let cancelled = false;
    setTranslating(true);

    translateSentence(sentence.raw, language)
      .then(res => {
        if (cancelled) return;
        const next: SentenceTranslation = {
          translation: res.translation || '',
          chunks: res.chunks?.length
            ? res.chunks
            : [{ original: sentence.raw, translation: res.translation || '—' }],
          words: res.words || [],
        };
        cacheRef.current.set(sentence.id, next);
        LayoutAnimation.configureNext(SMOOTH);
        setChunks(next.chunks);
        setContentWords(next.words);
      })
      .catch(err => {
        console.log('[TranslationBox] translateSentence error', err?.message);
        if (!cancelled) {
          LayoutAnimation.configureNext(SMOOTH);
          setChunks([{ original: sentence.raw, translation: '—' }]);
          setContentWords([]);
        }
      })
      .finally(() => { if (!cancelled) setTranslating(false); });

    return () => { cancelled = true; };
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
    if (entry) {
      LayoutAnimation.configureNext(SMOOTH);
      setSelectedWord(entry);
    }
  }

  function tokenizeChunk(text: string): string[] {
    return text.split(/(\s+)/).filter(p => p.length > 0);
  }

  return (
    <View style={styles.box}>
      {translating ? (
        <ActivityIndicator color={colors.primary} style={styles.boxLoader} />
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

  readerBody: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },

  // Flowing source text
  paragraphWrap: { marginBottom: spacing.md },
  paragraph: { lineHeight: fontSize.sm * 1.7 },
  sentence: {
    fontSize: fontSize.sm,
    color: colors.text,
    lineHeight: fontSize.sm * 1.7,
  },
  sentenceActive: {
    fontSize: fontSize.sm,
    color: colors.primary,
    lineHeight: fontSize.sm * 1.7,
    backgroundColor: '#dbeafe',
  },

  // Inline translation box
  box: {
    marginTop: spacing.sm,
    backgroundColor: colors.cardBackground,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  boxLoader: { marginVertical: spacing.sm },

  chunk: { marginBottom: spacing.md },
  chunkTranslation: {
    fontSize: fontSize.sm,
    color: colors.text,
    fontWeight: '500',
    lineHeight: fontSize.sm * 1.4,
    marginBottom: 6,
  },
  chunkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  chunkOriginal: {
    flex: 1,
    fontSize: fontSize.xs,
    color: colors.muted,
    lineHeight: fontSize.xs * 1.65,
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
    marginTop: spacing.xs,
    backgroundColor: colors.background,
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
