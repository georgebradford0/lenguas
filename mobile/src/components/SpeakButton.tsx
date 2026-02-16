import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { spacing, fontSize, borderRadius } from '../styles/theme';

interface SpeakButtonProps {
  onPress: () => void;
  size?: 'normal' | 'large';
}

export function SpeakButton({ onPress, size = 'normal' }: SpeakButtonProps) {
  const buttonStyle = size === 'large' ? styles.buttonLarge : styles.button;
  const iconStyle = size === 'large' ? styles.iconLarge : styles.icon;

  return (
    <TouchableOpacity style={buttonStyle} onPress={onPress} activeOpacity={0.7}>
      <Text style={iconStyle}>🔊</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    padding: spacing.xs,
    borderRadius: borderRadius.sm,
  },
  buttonLarge: {
    padding: spacing.lg,
    borderRadius: borderRadius.lg,
    backgroundColor: 'rgba(52, 152, 219, 0.1)',
  },
  icon: {
    fontSize: fontSize.xl,
  },
  iconLarge: {
    fontSize: fontSize.xl * 2,
  },
});
