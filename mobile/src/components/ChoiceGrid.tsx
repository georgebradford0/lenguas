import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { Choice, ChoiceState } from '../types';
import { colors, spacing } from '../styles/theme';
import { ChoiceButton } from './ChoiceButton';
import { useIsTablet } from '../hooks/useIsTablet';

interface ChoiceGridProps {
  choices: Choice[] | null;
  selectedIndex: number | null;
  answered: boolean;
  onSelect: (index: number) => void;
}

export function ChoiceGrid({ choices, selectedIndex, answered, onSelect }: ChoiceGridProps) {
  const isTablet = useIsTablet();

  if (!choices) {
    return (
      <View style={styles.loading}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  const getState = (index: number): ChoiceState => {
    if (!answered) {
      return 'default';
    }

    const choice = choices[index];
    if (index === selectedIndex) {
      return choice.correct ? 'correct' : 'wrong';
    }
    if (choice.correct) {
      return 'reveal';
    }
    return 'disabled';
  };

  return (
    <View style={styles.grid}>
      {choices.map((choice, index) => (
        <View key={index} style={[styles.buttonWrapper, isTablet && styles.buttonWrapperTablet]}>
          <ChoiceButton
            text={choice.text}
            state={getState(index)}
            onPress={() => onSelect(index)}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  buttonWrapper: {
    width: '48%',
    marginBottom: spacing.sm + spacing.xs,
  },
  buttonWrapperTablet: {
    marginBottom: spacing.md,
  },
  loading: {
    padding: spacing.md,
    alignItems: 'center',
  },
  loadingText: {
    color: colors.loadingText,
  },
});
