import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
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

const TIER_NAMES = ['Core', 'Functional', 'Structural', 'Refinement'];
const TIER_COLORS = [colors.tier1, colors.tier2, colors.tier3, colors.tier4];
const MAX_BAR_HEIGHT = 80; // Maximum height of histogram bars in pixels
const SCREEN_WIDTH = Dimensions.get('window').width;

export function StatsBar({ accuracy, tierStats, currentTier, wordProgress }: StatsBarProps) {
  // Find the current tier's stats
  const currentTierStat = tierStats.find(t => t.tier === currentTier);

  if (!currentTierStat || !wordProgress || wordProgress.length === 0) return null;

  // Find max attempts for scaling
  const maxAttempts = Math.max(...wordProgress.map(w => w.attempts), 1);

  // Calculate bar width to fill screen (minus padding)
  const totalPadding = spacing.lg * 2; // Left and right padding
  const availableWidth = SCREEN_WIDTH - totalPadding;
  const barWidth = Math.floor(availableWidth / wordProgress.length);

  // Calculate mastery threshold line position (fixed at 7 attempts)
  const MASTERY_ATTEMPTS = 7;
  const masteryLineHeight = (MASTERY_ATTEMPTS / Math.max(maxAttempts, MASTERY_ATTEMPTS)) * MAX_BAR_HEIGHT;

  // Calculate progress percentage: (total correct attempts) / (total words × 7 required)
  const totalCorrectAttempts = wordProgress.reduce((sum, w) => sum + Math.round(w.attempts * (w.accuracy / 100)), 0);
  const requiredAttempts = wordProgress.length * MASTERY_ATTEMPTS;
  const masteryPercentage = Math.min(100, Math.round((totalCorrectAttempts / requiredAttempts) * 100));

  // Count of actually mastered words
  const masteredWords = wordProgress.filter(w => w.attempts >= 7 && w.accuracy >= 75).length;

  // Calculate bar heights (upside down, so height represents progress)
  const bars = wordProgress.map(w => {
    const heightRatio = w.attempts / Math.max(maxAttempts, 7); // Scale to at least 7 for better visuals
    const height = heightRatio * MAX_BAR_HEIGHT;

    // Color based on accuracy
    let barColor = colors.muted;
    if (w.attempts === 0) {
      barColor = colors.border;
    } else if (w.accuracy >= 80) {
      barColor = colors.correct;
    } else if (w.accuracy >= 60) {
      barColor = colors.primary;
    } else {
      barColor = colors.wrong;
    }

    return { ...w, height, barColor, barWidth };
  });

  return (
    <View style={styles.container}>
      {/* Tier Header */}
      <View style={styles.tierHeader}>
        <Text style={[styles.tierLabel, { color: TIER_COLORS[currentTierStat.tier - 1] }]}>
          Tier {currentTierStat.tier}: {TIER_NAMES[currentTierStat.tier - 1]}
        </Text>
        <Text style={styles.masteryPercentage}>
          {masteryPercentage}% mastered
        </Text>
      </View>

      {/* Upside-down Histogram with Mastery Line */}
      <View style={styles.histogramWrapper}>
        <View style={styles.histogramContainer}>
          {bars.map((bar, index) => (
            <View key={index} style={[styles.barWrapper, { width: bar.barWidth }]}>
              <View
                style={[
                  styles.bar,
                  {
                    height: bar.height,
                    backgroundColor: bar.barColor,
                  },
                ]}
              />
            </View>
          ))}
        </View>

        {/* Mastery threshold line */}
        <View
          style={[
            styles.masteryLine,
            {
              top: masteryLineHeight,
            },
          ]}
        />
      </View>

      {/* Legend */}
      <View style={styles.legend}>
        <Text style={styles.legendText}>
          {masteredWords}/{wordProgress.length} words at mastery (7+ attempts, 75%+ accuracy)
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.cardBackground,
    width: '100%',
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tierHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  tierLabel: {
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  masteryPercentage: {
    fontSize: fontSize.lg,
    color: colors.primary,
    fontWeight: '700',
  },
  histogramWrapper: {
    position: 'relative',
    width: '100%',
    height: MAX_BAR_HEIGHT,
    marginBottom: spacing.xs,
  },
  histogramContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    width: '100%',
    height: MAX_BAR_HEIGHT,
  },
  barWrapper: {
    height: MAX_BAR_HEIGHT,
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  bar: {
    width: '100%',
    borderRadius: 1,
  },
  masteryLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: '#FFD700', // Gold color
    opacity: 0.9,
    zIndex: 10,
  },
  legend: {
    alignItems: 'center',
  },
  legendText: {
    fontSize: fontSize.xs,
    color: colors.muted,
    fontWeight: '500',
  },
});
