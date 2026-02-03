import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, fontSize, borderRadius } from '../styles/theme';
import { SpeakButton } from './SpeakButton';

interface WordCardProps {
  word: string;
  onSpeak: () => void;
}

export function WordCard({ word, onSpeak }: WordCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.wordRow}>
        <Text style={styles.word}>{word}</Text>
        <SpeakButton onPress={onSpeak} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.cardBackground,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
    width: '100%',
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
    elevation: 8,
    marginBottom: spacing.lg,
  },
  wordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm + spacing.xs,
  },
  word: {
    fontSize: fontSize.word,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
});
