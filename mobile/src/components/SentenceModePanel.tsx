import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView,
} from 'react-native';
import RNFS from 'react-native-fs';
import { createSound } from 'react-native-nitro-sound';
import { speak, translateSentence } from '../api/client';
import type { SentenceWord } from '../api/client';
import { cleanWord } from '../utils/epubParser';
import type { Sentence } from '../utils/epubParser';
import { colors, spacing, fontSize, borderRadius } from '../styles/theme';
import type { Language } from '../types';

type Sound = ReturnType<typeof createSound>;

interface Props {
  sentence: Sentence;
  language: Language;
  position: { current: number; total: number };
  chapterTitle: string;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onBack: () => void;
}

export function SentenceModePanel({
  sentence, language, position, chapterTitle, canPrev, canNext, onPrev, onNext, onBack,
}: Props) {
  const [translation, setTranslation] = useState<string | null>(null);
  const [contentWords, setContentWords] = useState<SentenceWord[]>([]);
  const [translating, setTranslating] = useState(false);
  const [selectedWord, setSelectedWord] = useState<SentenceWord | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
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

  // On sentence change: fetch translation + content words, auto-play audio.
  useEffect(() => {
    if (!sentence) return;
    setSelectedWord(null);
    setTranslation(null);
    setContentWords([]);
    setTranslating(true);

    let cancelled = false;
    translateSentence(sentence.raw, language)
      .then(res => {
        if (cancelled) return;
        setTranslation(res.translation || '—');
        setContentWords(res.words || []);
      })
      .catch(err => {
        console.log('[SentenceMode] translateSentence error', err?.message);
        if (!cancelled) {
          setTranslation('—');
          setContentWords([]);
        }
      })
      .finally(() => { if (!cancelled) setTranslating(false); });

    playAudio(sentence.raw);
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

  async function playAudio(text: string) {
    await stopAudio();
    setAudioLoading(true);
    try {
      const base64 = await speak(text, language);
      const key = text.slice(0, 40).replace(/[^a-zA-Z0-9]/g, '_');
      const path = `${RNFS.CachesDirectoryPath}/sent_${language}_${key}.mp3`;
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
      setAudioLoading(false);
    }
  }

  function handleWordTap(rawWord: string) {
    const entry = contentLookup.get(cleanWord(rawWord).toLowerCase());
    if (entry) setSelectedWord(entry);
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerBtn} onPress={onBack}>
          <Text style={styles.headerBtnText}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>{chapterTitle}</Text>
          <Text style={styles.headerCounter}>{position.current} / {position.total}</Text>
        </View>
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={() => playAudio(sentence.raw)}
          disabled={audioLoading}
        >
          <Text style={styles.headerBtnText}>{audioLoading ? '⌛' : '🔊'}</Text>
        </TouchableOpacity>
      </View>

      {/* Body */}
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Translation first (native language) */}
        {translating ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : (
          <Text style={styles.translation}>{translation ?? '—'}</Text>
        )}

        <View style={styles.divider} />

        {/* Original sentence — only nouns/verbs tappable */}
        <Text style={styles.original}>
          {sentence.words.map(word => {
            if (!word.isWord) {
              return <Text key={word.id} style={styles.nonContent}>{word.text}</Text>;
            }
            const clean = cleanWord(word.text).toLowerCase();
            const entry = contentLookup.get(clean);
            const isPressable = !!entry;
            const isActive = selectedWord
              && cleanWord(selectedWord.word).toLowerCase() === clean;
            if (isPressable) {
              return (
                <Text
                  key={word.id}
                  onPress={() => handleWordTap(word.text)}
                  style={[styles.contentWord, isActive && styles.contentWordActive]}
                >
                  {word.text}
                </Text>
              );
            }
            return <Text key={word.id} style={styles.nonContent}>{word.text}</Text>;
          })}
        </Text>

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
  headerTitle: { fontSize: fontSize.xs, fontWeight: '600', color: colors.text },
  headerCounter: { fontSize: 12, color: colors.muted, marginTop: 2 },

  body: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    flexGrow: 1,
  },
  loader: { marginVertical: spacing.lg },

  translation: {
    fontSize: fontSize.md,
    color: colors.text,
    fontWeight: '600',
    lineHeight: fontSize.md * 1.4,
  },

  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },

  original: {
    fontSize: fontSize.sm,
    color: colors.muted,
    lineHeight: fontSize.sm * 1.7,
  },
  nonContent: { color: colors.muted },
  contentWord: {
    color: colors.text,
    fontWeight: '600',
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
