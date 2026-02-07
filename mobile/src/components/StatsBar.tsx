import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, fontSize, borderRadius } from '../styles/theme';

interface TierStat {
  tier: number;
  total: number;
  mastered: number;
  percentage: number;
}

interface StatsBarProps {
  accuracy: number;
  tierStats: TierStat[];
}

const TIER_NAMES = ['Core', 'Functional', 'Structural', 'Refinement'];
const TIER_COLORS = [colors.tier1, colors.tier2, colors.tier3, colors.tier4];

export function StatsBar({ accuracy, tierStats }: StatsBarProps) {
  return (
    <View style={styles.container}>
      {/* Tier Progress */}
      <View style={styles.tierSection}>
        {tierStats.map((tierStat) => (
          <View key={tierStat.tier} style={styles.tierRow}>
            <View style={styles.tierHeader}>
              <Text style={[styles.tierLabel, { color: TIER_COLORS[tierStat.tier - 1] }]}>
                Tier {tierStat.tier}: {TIER_NAMES[tierStat.tier - 1]}
              </Text>
              <Text style={styles.tierNumbers}>
                {tierStat.mastered}/{tierStat.total} ({tierStat.percentage}%)
              </Text>
            </View>
            <View style={styles.progressBarContainer}>
              <View
                style={[
                  styles.progressBarFill,
                  {
                    width: `${tierStat.percentage}%`,
                    backgroundColor: TIER_COLORS[tierStat.tier - 1],
                  },
                ]}
              />
            </View>
          </View>
        ))}
      </View>

      {/* Overall Accuracy */}
      <View style={styles.accuracySection}>
        <Text style={styles.accuracyLabel}>Overall Accuracy</Text>
        <Text style={[styles.accuracyValue, { color: accuracy >= 75 ? colors.correct : colors.wrong }]}>
          {accuracy}%
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.cardBackground,
    width: '100%',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tierSection: {
    marginBottom: spacing.md,
  },
  tierRow: {
    marginBottom: spacing.md,
  },
  tierHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  tierLabel: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  tierNumbers: {
    fontSize: fontSize.sm,
    color: colors.muted,
    fontWeight: '500',
  },
  progressBarContainer: {
    height: 12,
    backgroundColor: colors.progressBar,
    borderRadius: borderRadius.sm,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: borderRadius.sm,
  },
  accuracySection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  accuracyLabel: {
    fontSize: fontSize.md,
    color: colors.muted,
    fontWeight: '600',
  },
  accuracyValue: {
    fontSize: fontSize.xl,
    fontWeight: 'bold',
  },
});
