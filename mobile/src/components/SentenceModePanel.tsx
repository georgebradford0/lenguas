import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView,
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

interface Props {
  sentence: Sentence;
  language: Language;
  position: { current: number; total: number };
  bookTitle: string | null;
  bookAuthor: string | null;
  chapterTitle: string;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onBack: () => void;
}

export function SentenceModePanel({
  sentence, language, position, bookTitle, bookAuthor, chapterTitle, canPrev, canNext, onPrev, onNext, onBack,
}: Props) {
  const [chunks, setChunks] = useState<SentenceChunk[]>([]);
  const [contentWords, setContentWords] = useState<SentenceWord[]>([]);
  const [translating, setTranslating] = useState(false);
  const [selectedWord, setSelectedWord] = useState<SentenceWord | null>(null);
  const [playingChunkIdx, setPlayingChunkIdx] = useState<number | null>(null);
  const soundRef = useRef<Sound | null>(null);

  // Map cleaned-lowercased surface form → word entry, so taps look up data we already fetched.
  const contentLookup = useMemo(() => {
    const m = new Map<string, SentenceWord>();
    for (const w of contentWords) {
      const key = cleanWord(w.word).toLowerCase();
      if (key && !m.has(key)) m.set(key, w);
    }
    return m;
  }, [contentWords]);

  // On sentence change: fetch chunks + content words. No auto-play.
  useEffect(() => {
    if (!sentence) return;
    setSelectedWord(null);
    setChunks([]);
    setContentWords([]);
    setTranslating(true);
    stopAudio();

    let cancelled = false;
    translateSentence(sentence.raw, language)
      .then(res => {
        if (cancelled) return;
        setChunks(res.chunks?.length ? res.chunks : [{ original: sentence.raw, translation: res.translation || '—' }]);
        setContentWords(res.words || []);
      })
      .catch(err => {
        console.log('[SentenceMode] translateSentence error', err?.message);
        if (!cancelled) {
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
    if (entry) setSelectedWord(entry);
  }

  // Split a chunk's original text into whitespace-delimited tokens for tap rendering.
  function tokenizeChunk(text: string): string[] {
    return text.split(/(\s+)/).filter(p => p.length > 0);
  }

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
          <Text style={styles.headerCounter}>{position.current} / {position.total}</Text>
        </View>
        <View style={styles.headerBtn} />
      </View>

      {/* Body */}
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {translating ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : (
          chunks.map((chunk, idx) => {
            const isPlaying = playingChunkIdx === idx;
            return (
              <View key={idx} style={styles.chunkCard}>
                <View style={styles.chunkText}>
                  <Text style={styles.chunkTranslation}>{chunk.translation || '—'}</Text>
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
                </View>
                <TouchableOpacity
                  style={styles.chunkPlayBtn}
                  onPress={() => playChunkAudio(chunk.original, idx)}
                  disabled={isPlaying}
                >
                  <Text style={styles.chunkPlayBtnText}>{isPlaying ? '⌛' : '🔊'}</Text>
                </TouchableOpacity>
              </View>
            );
          })
        )}

        {/* Selected word card */}
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

      {/* Navigation */}
      <View style={styles.nav}>
        <TouchableOpacity
          style={[styles.navBtn, !canPrev && styles.navBtnDisabled]}
          onPress={onPrev}
          disabled={!canPrev}
        >
          <Text style={styles.navBtnText}>‹ Prev</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.navBtn, styles.navBtnNext, !canNext && styles.navBtnDisabled]}
          onPress={onNext}
          disabled={!canNext}
        >
          <Text style={[styles.navBtnText, styles.navBtnNextText]}>Next ›</Text>
        </TouchableOpacity>
      </View>
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

  body: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    flexGrow: 1,
  },
  loader: { marginVertical: spacing.lg },

  chunkCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  chunkText: { flex: 1 },
  chunkTranslation: {
    fontSize: fontSize.md,
    color: colors.text,
    fontWeight: '600',
    lineHeight: fontSize.md * 1.35,
    marginBottom: 4,
  },
  chunkOriginal: {
    fontSize: fontSize.sm,
    color: colors.muted,
    lineHeight: fontSize.sm * 1.6,
  },
  chunkPlayBtn: {
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardBackground,
    marginTop: 2,
  },
  chunkPlayBtnText: { fontSize: fontSize.sm },

  nonContent: { color: colors.muted },
  contentWord: {
    color: colors.text,
    fontWeight: '600',
    textDecorationLine: 'underline',
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

  nav: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    backgroundColor: colors.cardBackground,
  },
  navBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  navBtnNext: { backgroundColor: colors.primary, borderColor: colors.primary },
  navBtnDisabled: { opacity: 0.3 },
  navBtnText: { fontSize: fontSize.xs, color: colors.text, fontWeight: '500' },
  navBtnNextText: { color: '#fff' },
});
