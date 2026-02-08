import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
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
const MAX_BAR_HEIGHT = 40; // Maximum height of histogram bars in pixels

export function StatsBar({ accuracy, tierStats, currentTier, wordProgress }: StatsBarProps) {
  // Find the current tier's stats
  const currentTierStat = tierStats.find(t => t.tier === currentTier);

  if (!currentTierStat || !wordProgress || wordProgress.length === 0) return null;

  // Find max attempts for scaling
  const maxAttempts = Math.max(...wordProgress.map(w => w.attempts), 1);

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

    return { ...w, height, barColor };
  });

  return (
    <View style={styles.container}>
      {/* Tier Header */}
      <View style={styles.tierHeader}>
        <Text style={[styles.tierLabel, { color: TIER_COLORS[currentTierStat.tier - 1] }]}>
          Tier {currentTierStat.tier}: {TIER_NAMES[currentTierStat.tier - 1]}
        </Text>
        <Text style={styles.tierNumbers}>
          {currentTierStat.total} words • {currentTierStat.totalAttempts} attempts
        </Text>
      </View>

      {/* Upside-down Histogram */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.histogramScroll}
        contentContainerStyle={styles.histogramContainer}
      >
        {bars.map((bar, index) => (
          <View key={index} style={styles.barWrapper}>
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
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.cardBackground,
    width: '100%',
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tierHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  tierLabel: {
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  tierNumbers: {
    fontSize: fontSize.xs,
    color: colors.muted,
    fontWeight: '500',
  },
  histogramScroll: {
    width: '100%',
  },
  histogramContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  barWrapper: {
    width: 3,
    height: MAX_BAR_HEIGHT,
    marginHorizontal: 0.5,
    justifyContent: 'flex-start',
  },
  bar: {
    width: '100%',
    borderRadius: 1,
  },
});
