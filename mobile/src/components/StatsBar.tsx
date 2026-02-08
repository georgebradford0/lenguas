import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, fontSize } from '../styles/theme';
import type { WordProgress } from '../types';

interface TierStat {
  tier: number;
  total: number;
  mastered: number;
  percentage: number;
}

interface StatsBarProps {
  accuracy: number;
  tierStats: TierStat[];
  currentTier: number;
  wordProgress: WordProgress[];
}

const TIER_COLORS = [colors.tier1, colors.tier2, colors.tier3, colors.tier4];

export function StatsBar({ accuracy, tierStats, currentTier, wordProgress }: StatsBarProps) {
  // Find the current tier's stats
  const currentTierStat = tierStats.find(t => t.tier === currentTier);

  if (!currentTierStat || !wordProgress || wordProgress.length === 0) return null;

  // Calculate mastery threshold line position (fixed at 7 attempts)
  const MASTERY_ATTEMPTS = 7;

  // Calculate progress percentage: (total correct attempts) / (total words × 7 required)
  const totalCorrectAttempts = wordProgress.reduce((sum, w) => sum + Math.round(w.attempts * (w.accuracy / 100)), 0);
  const requiredAttempts = wordProgress.length * MASTERY_ATTEMPTS;
  const masteryPercentage = Math.min(100, Math.round((totalCorrectAttempts / requiredAttempts) * 100));

  return (
    <View style={styles.container}>
      <View style={styles.centeredContent}>
        <Text style={[styles.tierText, { color: TIER_COLORS[currentTierStat.tier - 1] }]}>
          Tier {currentTierStat.tier}
        </Text>
        <Text style={styles.percentageText}>
          {masteryPercentage}%
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.cardBackground,
    width: '100%',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  centeredContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  tierText: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  percentageText: {
    fontSize: fontSize.xxl,
    color: colors.primary,
    fontWeight: '700',
  },
});
