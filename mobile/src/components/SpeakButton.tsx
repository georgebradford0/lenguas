import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { spacing, fontSize, borderRadius } from '../styles/theme';

interface SpeakButtonProps {
  onPress: () => void;
}

export function SpeakButton({ onPress }: SpeakButtonProps) {
  return (
    <TouchableOpacity style={styles.button} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.icon}>🔊</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    padding: spacing.xs,
    borderRadius: borderRadius.sm,
  },
  icon: {
    fontSize: fontSize.xl,
  },
});
