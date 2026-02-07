import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { colors, spacing, fontSize, borderRadius } from '../styles/theme';

interface TierUnlockCelebrationProps {
  tier: number;
  onDismiss: () => void;
}

const TIER_MESSAGES = {
  2: {
    title: 'Tier 2 Unlocked! 🎉',
    message: 'You\'re ready to learn in German!\nNew vocabulary and patterns await.',
    milestone: 'You can now order food and ask basic questions',
  },
  3: {
    title: 'Tier 3 Unlocked! 🚀',
    message: 'You can understand simple German stories!\nModal verbs and complex sentences unlocked.',
    milestone: 'You\'re approaching conversational threshold',
  },
  4: {
    title: 'Tier 4 Unlocked! 🌟',
    message: 'You can learn any German word using German!\nRefinement and advanced grammar ahead.',
    milestone: 'Full monolingual capability achieved',
  },
};

export function TierUnlockCelebration({ tier, onDismiss }: TierUnlockCelebrationProps) {
  const scaleAnim = new Animated.Value(0);
  const opacityAnim = new Animated.Value(0);

  useEffect(() => {
    // Animate in
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 50,
        friction: 7,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const tierInfo = TIER_MESSAGES[tier as keyof typeof TIER_MESSAGES] || {
    title: `Tier ${tier} Unlocked!`,
    message: 'Keep up the great work!',
    milestone: 'New challenges await',
  };

  return (
    <Animated.View
      style={[
        styles.overlay,
        {
          opacity: opacityAnim,
        },
      ]}
    >
      <Animated.View
        style={[
          styles.card,
          {
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        <Text style={styles.title}>{tierInfo.title}</Text>
        <Text style={styles.message}>{tierInfo.message}</Text>
        <View style={styles.milestoneBox}>
          <Text style={styles.milestoneLabel}>Milestone</Text>
          <Text style={styles.milestoneText}>{tierInfo.milestone}</Text>
        </View>
        <TouchableOpacity style={styles.button} onPress={onDismiss}>
          <Text style={styles.buttonText}>Continue Learning</Text>
        </TouchableOpacity>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    zIndex: 1000,
  },
  card: {
    backgroundColor: colors.cardBackground,
    borderRadius: borderRadius.xl,
    padding: spacing.xxl,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: 'bold',
    color: colors.primary,
    marginBottom: spacing.lg,
    textAlign: 'center',
  },
  message: {
    fontSize: fontSize.lg,
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.xl,
    lineHeight: fontSize.lg * 1.5,
  },
  milestoneBox: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    marginBottom: spacing.xl,
    width: '100%',
    borderWidth: 1,
    borderColor: colors.border,
  },
  milestoneLabel: {
    fontSize: fontSize.sm,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  milestoneText: {
    fontSize: fontSize.md,
    color: colors.text,
    textAlign: 'center',
    fontWeight: '600',
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    minWidth: 200,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: fontSize.lg,
    fontWeight: 'bold',
    textAlign: 'center',
  },
});
