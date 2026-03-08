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
      <View style={styles.wordRow}>
        <Text style={[styles.word, isTablet && styles.wordTablet]}>{word}</Text>
        <SpeakButton onPress={onSpeak} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.cardBackground,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.xxl * 1.5,
    paddingHorizontal: spacing.xxl,
    width: '100%',
    minHeight: 240,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
    marginBottom: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTablet: {
    minHeight: 360,
    paddingVertical: spacing.xxl * 2,
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
  wordTablet: {
    fontSize: fontSize.word * 1.5,
  },
});
