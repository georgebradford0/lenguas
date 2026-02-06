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
  total: number;
  unseen: number;
  reviewed: number;
  accuracy: number;
  tierStats: TierStat[];
}

const TIER_NAMES = ['Core', 'Functional', 'Structural', 'Refinement'];
const TIER_COLORS = [colors.tier1, colors.tier2, colors.tier3, colors.tier4];

export function StatsBar({ total, unseen, reviewed, accuracy, tierStats }: StatsBarProps) {
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

      {/* Session Stats */}
      <View style={styles.sessionStats}>
        <View style={styles.sessionStat}>
          <Text style={styles.sessionLabel}>Session</Text>
          <Text style={styles.sessionValue}>{reviewed} reviewed</Text>
        </View>
        <View style={styles.sessionStat}>
          <Text style={styles.sessionLabel}>Accuracy</Text>
          <Text style={[styles.sessionValue, { color: accuracy >= 75 ? colors.correct : colors.wrong }]}>
            {accuracy}%
          </Text>
        </View>
        <View style={styles.sessionStat}>
          <Text style={styles.sessionLabel}>Remaining</Text>
          <Text style={styles.sessionValue}>{unseen} new</Text>
        </View>
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
  sessionStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  sessionStat: {
    alignItems: 'center',
  },
  sessionLabel: {
    fontSize: fontSize.xs,
    color: colors.muted,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sessionValue: {
    fontSize: fontSize.md,
    color: colors.text,
    fontWeight: '600',
  },
});
