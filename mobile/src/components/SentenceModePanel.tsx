import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  ScrollView, Dimensions,
} from 'react-native';
import RNFS from 'react-native-fs';
import { createSound } from 'react-native-nitro-sound';
import { speak, translatePhrase, translateWord } from '../api/client';
import { cleanWord } from '../utils/epubParser';
import type { Sentence } from '../utils/epubParser';
import { colors, spacing, fontSize, borderRadius } from '../styles/theme';
import type { Language } from '../types';

type Sound = ReturnType<typeof createSound>;

export const PANEL_HEIGHT = Math.round(Dimensions.get('window').height * 0.58);

interface WordResult {
  word: string;
  translation: string;
  explanation: string | null;
}

interface Props {
  sentences: Sentence[];
  currentIdx: number;
  language: Language;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
}

export function SentenceModePanel({
  sentences, currentIdx, language, onClose, onNext, onPrev,
}: Props) {
  const [sentenceTranslation, setSentenceTranslation] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [wordResult, setWordResult] = useState<WordResult | null>(null);
  const [wordLoading, setWordLoading] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const soundRef = useRef<Sound | null>(null);

  const sentence = sentences[currentIdx];

  // On sentence change: fetch translation + auto-play
  useEffect(() => {
    if (!sentence) return;
    setWordResult(null);
    setSentenceTranslation(null);
    setTranslating(true);

    translatePhrase(sentence.raw, language)
      .then(t => setSentenceTranslation(t))
      .catch(() => setSentenceTranslation('—'))
      .finally(() => setTranslating(false));

    playAudio(sentence.raw);
  }, [currentIdx, sentence?.id]);

  // Cleanup audio on unmount
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

  const handleWordTap = useCallback(async (rawWord: string) => {
    if (!sentence) return;
    const clean = cleanWord(rawWord);
    if (!clean) return;
    setWordResult(null);
    setWordLoading(true);
    try {
      const result = await translateWord(clean, sentence.raw, language);
      setWordResult({ word: clean, ...result });
    } catch {
      setWordResult({ word: clean, translation: '—', explanation: null });
    } finally {
      setWordLoading(false);
    }
  }, [sentence, language]);

  if (!sentence) return null;

  return (
    <View style={styles.panel}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.closeButton} onPress={onClose}>
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>
        <Text style={styles.counter}>{currentIdx + 1} / {sentences.length}</Text>
        <TouchableOpacity
          style={styles.audioButton}
          onPress={() => playAudio(sentence.raw)}
          disabled={audioLoading}
        >
          <Text style={styles.audioIcon}>{audioLoading ? '⌛' : '🔊'}</Text>
        </TouchableOpacity>
      </View>

      {/* Scrollable content */}
      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentInner}
        showsVerticalScrollIndicator={false}
      >
        {/* Sentence text with tappable words */}
        <Text style={styles.sentenceText}>
          {sentence.words.map(word =>
            word.isWord ? (
              <Text
                key={word.id}
                onPress={() => handleWordTap(word.text)}
                style={[
                  styles.sentenceWord,
                  wordResult?.word === cleanWord(word.text) && styles.sentenceWordActive,
                ]}
              >
                {word.text}
              </Text>
            ) : (
              <Text key={word.id}>{word.text}</Text>
            ),
          )}
        </Text>

        {/* Sentence translation */}
        <View style={styles.divider} />
        {translating ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : (
          <Text style={styles.translationText}>{sentenceTranslation ?? '—'}</Text>
        )}

        {/* Word translation card */}
        {(wordLoading || wordResult) && (
          <View style={styles.wordCard}>
            {wordLoading ? (
              <ActivityIndicator color={colors.primary} />
            ) : wordResult ? (
              <>
                <Text style={styles.wordCardLabel}>{wordResult.word}</Text>
                <Text style={styles.wordCardTranslation}>{wordResult.translation}</Text>
                {wordResult.explanation ? (
                  <Text style={styles.wordCardExplanation}>{wordResult.explanation}</Text>
                ) : null}
              </>
            ) : null}
          </View>
        )}
      </ScrollView>

      {/* Navigation */}
      <View style={styles.nav}>
        <TouchableOpacity
          style={[styles.navBtn, currentIdx === 0 && styles.navBtnDisabled]}
          onPress={onPrev}
          disabled={currentIdx === 0}
        >
          <Text style={styles.navBtnText}>‹ Prev</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.navBtn, styles.navBtnNext, currentIdx >= sentences.length - 1 && styles.navBtnDisabled]}
          onPress={onNext}
          disabled={currentIdx >= sentences.length - 1}
        >
          <Text style={[styles.navBtnText, styles.navBtnNextText]}>Next ›</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: PANEL_HEIGHT,
    backgroundColor: colors.cardBackground,
    borderTopLeftRadius: borderRadius.lg,
    borderTopRightRadius: borderRadius.lg,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  closeButton: { padding: spacing.xs },
  closeText: { fontSize: fontSize.xs, color: colors.muted },
  counter: { fontSize: 13, color: colors.muted, fontWeight: '500' },
  audioButton: { padding: spacing.xs },
  audioIcon: { fontSize: 20 },

  content: { flex: 1 },
  contentInner: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },

  sentenceText: {
    fontSize: fontSize.sm,
    color: colors.text,
    lineHeight: fontSize.sm * 1.6,
    fontWeight: '500',
  },
  sentenceWord: {
    color: colors.text,
  },
  sentenceWordActive: {
    color: colors.primary,
    backgroundColor: '#dbeafe',
    borderRadius: 2,
  },

  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },
  translationText: {
    fontSize: fontSize.xs,
    color: colors.primary,
    fontWeight: '500',
    lineHeight: fontSize.xs * 1.5,
  },
  loader: { marginVertical: spacing.xs },

  wordCard: {
    marginTop: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    gap: 4,
  },
  wordCardLabel: {
    fontSize: 13,
    color: colors.muted,
    fontWeight: '500',
  },
  wordCardTranslation: {
    fontSize: fontSize.xs,
    color: colors.text,
    fontWeight: '600',
  },
  wordCardExplanation: {
    fontSize: 13,
    color: colors.muted,
    lineHeight: 18,
    marginTop: 2,
  },

  nav: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    gap: spacing.sm,
  },
  navBtn: {
    flex: 1,
    paddingVertical: spacing.xs,
    alignItems: 'center',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  navBtnNext: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  navBtnDisabled: { opacity: 0.3 },
  navBtnText: { fontSize: fontSize.xs, color: colors.text, fontWeight: '500' },
  navBtnNextText: { color: '#fff' },
});
