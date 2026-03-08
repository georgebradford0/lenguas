import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import type { ChoiceState } from '../types';
import { colors, spacing, fontSize, borderRadius } from '../styles/theme';
import { useIsTablet } from '../hooks/useIsTablet';

interface ChoiceButtonProps {
  text: string;
  state: ChoiceState;
  onPress: () => void;
}

export function ChoiceButton({ text, state, onPress }: ChoiceButtonProps) {
  const isDisabled = state === 'disabled' || state === 'correct' || state === 'wrong' || state === 'reveal';
  const isTablet = useIsTablet();

  return (
    <TouchableOpacity
      style={[styles.button, stateStyles[state], isTablet && styles.buttonTablet]}
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.7}
    >
      <Text style={[styles.text, textStateStyles[state], isTablet && styles.textTablet]}>{text}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    padding: spacing.lg,
    backgroundColor: colors.cardBackground,
    borderWidth: 3,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 80,
  },
  buttonTablet: {
    minHeight: 120,
    padding: spacing.xl,
  },
  text: {
    fontSize: fontSize.lg,
    color: colors.text,
    textAlign: 'center',
    fontWeight: '500',
    width: '100%',
    textAlignVertical: 'center',
  },
  textTablet: {
    fontSize: fontSize.xl,
  },
});

const stateStyles = StyleSheet.create({
  default: {},
  correct: {
    backgroundColor: colors.correctBackground,
    borderColor: colors.correct,
  },
  wrong: {
    backgroundColor: colors.wrongBackground,
    borderColor: colors.wrong,
  },
  reveal: {
    borderColor: colors.correct,
  },
  disabled: {
    opacity: 0.6,
  },
});

const textStateStyles = StyleSheet.create({
  default: {},
  correct: {
    color: '#fff',
  },
  wrong: {
    color: '#fff',
  },
  reveal: {
    color: colors.correct,
  },
  disabled: {},
});
