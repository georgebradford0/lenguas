import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors, spacing, fontSize } from '../styles/theme';
import type { WordProgress, LevelStats } from '../types';

interface TierStat {
  tier: number;
  total: number;
  mastered: number;
  percentage: number;
}

interface StatsBarProps {
  accuracy: number;
  // Support both tier-based (legacy) and level-based (new) stats
  tierStats?: TierStat[];
  currentTier?: number;
  levelStats?: LevelStats[];
  currentLevel?: string; // A1, A2, or B1
  wordProgress: WordProgress[];
  onBack?: () => void;
}

const TIER_COLORS = [colors.tier1, colors.tier2, colors.tier3, colors.tier4];
const LEVEL_COLORS: Record<string, string> = {
  'A1': colors.tier1,
  'A2': colors.tier2,
  'B1': colors.tier3,
};

export function StatsBar({
  accuracy,
  tierStats,
  currentTier,
  levelStats,
  currentLevel,
  wordProgress,
  onBack,
}: StatsBarProps) {
  // Determine if we're using the new level system or old tier system
  const isLevelBased = !!currentLevel && !!levelStats;

  // Find the current stats
  let currentStats;
  let displayText;
  let displayColor;

  if (isLevelBased && currentLevel && levelStats) {
    // New level-based system
    currentStats = levelStats.find(l => l.level === currentLevel);
    displayText = currentLevel;
    displayColor = LEVEL_COLORS[currentLevel] || colors.primary;
  } else if (currentTier && tierStats) {
    // Legacy tier-based system
    currentStats = tierStats.find(t => t.tier === currentTier);
    displayText = `Tier ${currentTier}`;
    displayColor = TIER_COLORS[currentTier - 1] || colors.primary;
  }

  if (!currentStats || !wordProgress || wordProgress.length === 0) {
    if (onBack) {
      return (
        <View style={styles.container}>
          <TouchableOpacity style={styles.backButton} onPress={onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.backButtonText}>‹</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return null;
  }

  // Calculate mastery threshold line position (fixed at 7 attempts)
  const MASTERY_ATTEMPTS = 7;

  // Calculate progress percentage: (total correct attempts) / (total words × 7 required)
  const totalCorrectAttempts = wordProgress.reduce(
    (sum, w) => sum + Math.round(w.attempts * (w.accuracy / 100)),
    0
  );
  const requiredAttempts = wordProgress.length * MASTERY_ATTEMPTS;
  const masteryPercentage = Math.min(100, Math.round((totalCorrectAttempts / requiredAttempts) * 100));

  return (
    <View style={styles.container}>
      {onBack && (
        <TouchableOpacity style={styles.backButton} onPress={onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.backButtonText}>‹</Text>
        </TouchableOpacity>
      )}
      <View style={styles.centeredContent}>
        <Text style={[styles.levelText, { color: displayColor }]}>
          {displayText}
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
  backButton: {
    position: 'absolute',
    left: spacing.lg,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
  },
  backButtonText: {
    fontSize: 36,
    color: colors.muted,
    fontWeight: '300',
    lineHeight: 40,
  },
  centeredContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelText: {
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
