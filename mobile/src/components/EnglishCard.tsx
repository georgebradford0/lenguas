import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, fontSize, borderRadius } from '../styles/theme';

interface EnglishCardProps {
  english: string;
}

/**
 * Card showing English word (for speech recognition task)
 * Similar to WordCard but without speaker button
 */
export function EnglishCard({ english }: EnglishCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.prompt}>Say this in German:</Text>
      <Text style={styles.english}>{english}</Text>
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
  prompt: {
    fontSize: fontSize.md,
    color: colors.muted,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  english: {
    fontSize: fontSize.xxl,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
});
