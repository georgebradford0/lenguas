import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  Animated, Pressable,
} from 'react-native';
import { translatePhrase, speak } from '../api/client';
import { createSound } from 'react-native-nitro-sound';
type Sound = ReturnType<typeof createSound>;
import RNFS from 'react-native-fs';
import { colors, spacing, fontSize, borderRadius } from '../styles/theme';
import { cleanWord } from '../utils/epubParser';

const CARD_HEIGHT = 230;

interface Props {
  wordId: string;      // changes when a new word is tapped — drives the translation effect
  word: string;        // raw token (may include punctuation)
  sentence: string;    // full sentence for context
  language: string;    // source language code ('de', 'nl', etc.)
  onDismiss: () => void;
}

export function TranslationCard({ wordId, word, sentence, language, onDismiss }: Props) {
  const [translation, setTranslation] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [playing, setPlaying] = useState(false);
  const soundRef = useRef<Sound | null>(null);
  const slideAnim = useRef(new Animated.Value(CARD_HEIGHT)).current;
  const clean = cleanWord(word);

  // Slide up on mount
  useEffect(() => {
    Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
    return () => {
      // Cleanup audio when card unmounts
      if (soundRef.current) {
        try { soundRef.current.stopPlayer().catch(() => {}); } catch {}
        try { soundRef.current.dispose(); } catch {}
        soundRef.current = null;
      }
    };
  }, []);

  // Fetch translation whenever the word changes
  useEffect(() => {
    if (!clean) return;
    setTranslation(null);
    setTranslating(true);
    translatePhrase(clean, language)
      .then(t => setTranslation(t))
      .catch(() => setTranslation('—'))
      .finally(() => setTranslating(false));
  }, [wordId, clean, language]);

  async function handlePlay() {
    if (!clean || playing) return;
    try {
      setPlaying(true);
      const base64 = await speak(clean, language);
      const safeName = clean.replace(/[^a-zA-Z0-9]/g, '_');
      const path = `${RNFS.CachesDirectoryPath}/tr_${language}_${safeName}.mp3`;
      await RNFS.writeFile(path, base64, 'base64');

      const sound = createSound();
      soundRef.current = sound;

      await new Promise<void>((resolve) => {
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
    } finally {
      setPlaying(false);
    }
  }

  function handleDismiss() {
    Animated.timing(slideAnim, {
      toValue: CARD_HEIGHT,
      duration: 200,
      useNativeDriver: true,
    }).start(onDismiss);
  }

  return (
    <>
      {/* Tap-outside overlay */}
      <Pressable style={StyleSheet.absoluteFill} onPress={handleDismiss} />
      <Animated.View style={[styles.card, { transform: [{ translateY: slideAnim }] }]}>
        <View style={styles.handle} />

        <View style={styles.row}>
          <View style={styles.wordBlock}>
            <Text style={styles.wordText} numberOfLines={1}>{clean || word}</Text>
            <Text style={styles.sentenceText} numberOfLines={2}>{sentence}</Text>
          </View>
          <TouchableOpacity
            style={[styles.audioButton, playing && styles.audioButtonActive]}
            onPress={handlePlay}
            disabled={playing}
          >
            <Text style={styles.audioIcon}>{playing ? '⏳' : '🔊'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.divider} />

        {translating ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : (
          <Text style={styles.translationText}>{translation ?? '—'}</Text>
        )}
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: CARD_HEIGHT,
    backgroundColor: colors.cardBackground,
    borderTopLeftRadius: borderRadius.lg,
    borderTopRightRadius: borderRadius.lg,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 12,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  wordBlock: {
    flex: 1,
  },
  wordText: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 2,
  },
  sentenceText: {
    fontSize: 13,
    color: colors.muted,
    lineHeight: 18,
  },
  audioButton: {
    padding: spacing.xs,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  audioButtonActive: {
    opacity: 0.5,
  },
  audioIcon: {
    fontSize: 20,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },
  translationText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.primary,
  },
  loader: {
    marginTop: spacing.xs,
  },
});
