import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, fontSize, borderRadius } from '../styles/theme';

interface StatsBarProps {
  total: number;
  unseen: number;
  reviewed: number;
  accuracy: number;
}

export function StatsBar({ total, unseen, reviewed, accuracy }: StatsBarProps) {
  return (
    <View style={styles.container}>
      <View style={styles.stat}>
        <Text style={styles.statText}>Total: {total}</Text>
      </View>
      <View style={styles.stat}>
        <Text style={styles.statText}>Unseen: {unseen}</Text>
      </View>
      <View style={styles.stat}>
        <Text style={styles.statText}>Reviewed: {reviewed}</Text>
      </View>
      <View style={styles.stat}>
        <Text style={styles.statText}>Accuracy: {accuracy}%</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.cardBackground,
    width: '100%',
  },
  stat: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm + spacing.xs,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.background,
  },
  statText: {
    fontSize: fontSize.sm,
    color: colors.muted,
  },
});
