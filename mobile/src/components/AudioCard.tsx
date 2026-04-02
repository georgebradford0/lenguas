import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, fontSize, borderRadius } from '../styles/theme';
import { SpeakButton } from './SpeakButton';

interface AudioCardProps {
  onSpeak: () => void;
}

/**
 * Card for audio-only listening tasks
 * Shows only a speaker button and instructions, no text
 */
export function AudioCard({ onSpeak }: AudioCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.content}>
        <Text style={styles.instruction}>Listen and select the translation</Text>
        <SpeakButton onPress={onSpeak} size="large" />
        <Text style={styles.hint}>Tap to replay</Text>
      </View>
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
  },
  content: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  instruction: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  hint: {
    fontSize: fontSize.sm,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
