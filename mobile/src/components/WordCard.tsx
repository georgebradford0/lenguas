import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, fontSize, borderRadius } from '../styles/theme';
import { SpeakButton } from './SpeakButton';
import { useIsTablet } from '../hooks/useIsTablet';

interface WordCardProps {
  word: string;
  onSpeak: () => void;
}

export function WordCard({ word, onSpeak }: WordCardProps) {
  const isTablet = useIsTablet();
  return (
    <View style={[styles.card, isTablet && styles.cardTablet]}>
      <Text style={[styles.word, isTablet && styles.wordTablet]}>{word}</Text>
      <SpeakButton onPress={onSpeak} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.cardBackground,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    width: '100%',
    minHeight: 160,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  cardTablet: {
    minHeight: 280,
    paddingVertical: spacing.xxl,
    marginBottom: spacing.xl,
  },
  word: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  wordTablet: {
    fontSize: fontSize.word,
  },
});
