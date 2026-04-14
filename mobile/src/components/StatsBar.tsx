import React, { useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, TouchableWithoutFeedback } from 'react-native';
import { colors, spacing, fontSize } from '../styles/theme';
import { useIsTablet } from '../hooks/useIsTablet';
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
  onBlock?: () => void;
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
  onBlock,
}: StatsBarProps) {
  const isTablet = useIsTablet();
  const [menuVisible, setMenuVisible] = useState(false);
  const menuButtonRef = useRef<View>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; right: number }>({ top: 0, right: 0 });

  const handleMenuPress = () => {
    if (menuButtonRef.current) {
      menuButtonRef.current.measure((_x, _y, _width, height, _pageX, pageY) => {
        setMenuPosition({ top: pageY + height, right: spacing.lg });
        setMenuVisible(true);
      });
    } else {
      setMenuVisible(true);
    }
  };

  const handleRemoveWord = () => {
    setMenuVisible(false);
    onBlock?.();
  };

  const renderMenuButton = () => (
    <>
      <View ref={menuButtonRef} collapsable={false} style={styles.menuButtonWrapper}>
        <TouchableOpacity
          style={styles.menuButton}
          onPress={handleMenuPress}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.menuButtonText}>⋮</Text>
        </TouchableOpacity>
      </View>
      <Modal
        transparent
        visible={menuVisible}
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setMenuVisible(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={[styles.dropdown, { top: menuPosition.top, right: menuPosition.right }]}>
                <TouchableOpacity style={styles.dropdownItem} onPress={handleRemoveWord}>
                  <Text style={styles.dropdownItemText}>Remove word</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </>
  );

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
    if (onBack || onBlock) {
      return (
        <View style={styles.container}>
          {onBack && (
            <TouchableOpacity style={styles.backButton} onPress={onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.backButtonText}>‹</Text>
            </TouchableOpacity>
          )}
          {onBlock && renderMenuButton()}
        </View>
      );
    }
    return null;
  }

  // Use the backend's mastery percentage so 100% = level actually unlocks
  const masteryPercentage = currentStats.percentage;

  return (
    <View style={styles.container}>
      {onBack && (
        <TouchableOpacity style={styles.backButton} onPress={onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.backButtonText}>‹</Text>
        </TouchableOpacity>
      )}
      <View style={styles.centeredContent}>
        <Text style={[styles.levelText, isTablet && styles.levelTextTablet, { color: displayColor }]}>
          {displayText}
        </Text>
        <Text style={[styles.percentageText, isTablet && styles.percentageTextTablet]}>
          {masteryPercentage}%
        </Text>
      </View>
      {onBlock && renderMenuButton()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.cardBackground,
    width: '100%',
    paddingVertical: spacing.sm,
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
  menuButtonWrapper: {
    position: 'absolute',
    right: spacing.lg,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  menuButtonText: {
    fontSize: 22,
    color: colors.muted,
    fontWeight: '700',
    lineHeight: 26,
  },
  modalOverlay: {
    flex: 1,
  },
  dropdown: {
    position: 'absolute',
    backgroundColor: colors.cardBackground,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
    minWidth: 150,
  },
  dropdownItem: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  dropdownItemText: {
    fontSize: fontSize.md,
    color: colors.text,
  },
  centeredContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    marginBottom: 2,
  },
  levelTextTablet: {
    fontSize: fontSize.xl,
    marginBottom: spacing.sm,
  },
  percentageText: {
    fontSize: fontSize.lg,
    color: colors.primary,
    fontWeight: '700',
  },
  percentageTextTablet: {
    fontSize: fontSize.xxl,
  },
});
