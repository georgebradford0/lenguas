import React, { useCallback, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Animated, Dimensions } from 'react-native';
import { colors, spacing } from '../styles/theme';
import { useCards } from '../hooks/useCards';
import { StatsBar } from '../components/StatsBar';
import { MultipleChoiceTask } from '../components/MultipleChoiceTask';
import { ReverseTranslationTask } from '../components/ReverseTranslationTask';
import { TierUnlockCelebration } from '../components/TierUnlockCelebration';
import type { MultipleChoiceTaskData, ReverseTranslationTaskData } from '../types';

const SCREEN_WIDTH = Dimensions.get('window').width;

/**
 * Main quiz screen with dynamic task generation
 */
export function QuizScreen() {
  const {
    stats,
    currentTask,
    loading,
    error,
    taskLoading,
    submitting,
    tasksCompletedThisSession,
    tierJustUnlocked,
    handleAnswer,
    loadNextTask,
    dismissTierUnlock,
    tierStatsArray,
    currentTier,
    overallAccuracy,
    hasPreloadedTask,
  } = useCards();

  // Animation value for slide transition
  const slideAnim = useRef(new Animated.Value(0)).current;
  const taskIdRef = useRef<string | null>(null);

  // Animate in when task changes
  useEffect(() => {
    const currentTaskId = currentTask ? `${currentTask.targetWord}-${currentTask.tier}` : null;

    if (currentTaskId && currentTaskId !== taskIdRef.current) {
      taskIdRef.current = currentTaskId;

      // Start from right side and slide in
      slideAnim.setValue(SCREEN_WIDTH);
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 65,
        friction: 10,
      }).start();
    }
  }, [currentTask, slideAnim]);

  // Handle answer submission with slide animation
  const onAnswerMultipleChoice = useCallback(
    async (userAnswer: string, correctAnswer: string) => {
      // Slide out to the left
      Animated.timing(slideAnim, {
        toValue: -SCREEN_WIDTH,
        duration: 250,
        useNativeDriver: true,
      }).start();

      // Submit answer and load next task
      await handleAnswer(userAnswer, correctAnswer);
      await loadNextTask();
    },
    [handleAnswer, loadNextTask, slideAnim]
  );

  const onAnswerReverseTranslation = useCallback(
    async (userAnswer: string, correctAnswer: string) => {
      // Slide out to the left
      Animated.timing(slideAnim, {
        toValue: -SCREEN_WIDTH,
        duration: 250,
        useNativeDriver: true,
      }).start();

      // Submit answer and load next task
      await handleAnswer(userAnswer, correctAnswer);
      await loadNextTask();
    },
    [handleAnswer, loadNextTask, slideAnim]
  );

  // Initial loading
  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading your learning progress...</Text>
        </View>
      </View>
    );
  }

  // Error state
  if (error) {
    return (
      <View style={styles.container}>
        <View style={styles.centerContent}>
          <Text style={styles.errorText}>⚠️ {error}</Text>
          <Text style={styles.errorHint}>Please check your API connection</Text>
        </View>
      </View>
    );
  }

  // Task loading
  if (taskLoading || !currentTask) {
    return (
      <View style={styles.container}>
        <StatsBar
          accuracy={overallAccuracy}
          tierStats={tierStatsArray}
          currentTier={currentTier}
        />
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Generating your next task...</Text>
          <Text style={styles.tierIndicator}>Tier {currentTier}</Text>
        </View>
      </View>
    );
  }

  // Render appropriate task based on type
  const renderTask = () => {
    if (!currentTask) return null;

    switch (currentTask.taskType) {
      case 'multipleChoice':
        return (
          <MultipleChoiceTask
            taskData={currentTask.task as MultipleChoiceTaskData}
            onAnswer={onAnswerMultipleChoice}
          />
        );
      case 'reverseTranslation':
        return (
          <ReverseTranslationTask
            taskData={currentTask.task as ReverseTranslationTaskData}
            onAnswer={onAnswerReverseTranslation}
          />
        );
      default:
        return <Text style={styles.errorText}>Unknown task type</Text>;
    }
  };

  return (
    <View style={styles.container}>
      <StatsBar
        accuracy={overallAccuracy}
        tierStats={tierStatsArray}
        currentTier={currentTier}
      />
      <View style={styles.content}>
        {submitting && !hasPreloadedTask ? (
          <View style={styles.centerContent}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Checking answer...</Text>
          </View>
        ) : (
          <Animated.View
            style={[
              styles.taskContainer,
              {
                transform: [{ translateX: slideAnim }],
              },
            ]}
          >
            {renderTask()}
          </Animated.View>
        )}
      </View>

      {/* Tier unlock celebration overlay */}
      {tierJustUnlocked && (
        <TierUnlockCelebration tier={tierJustUnlocked} onDismiss={dismissTierUnlock} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
  },
  content: {
    flex: 1,
    width: '100%',
    maxWidth: 900,
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  taskContainer: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  loadingText: {
    color: colors.muted,
    fontSize: 16,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  tierIndicator: {
    color: colors.primary,
    fontSize: 14,
    textAlign: 'center',
    marginTop: spacing.sm,
    fontWeight: '600',
  },
  errorText: {
    color: colors.wrong,
    fontSize: 18,
    textAlign: 'center',
    marginBottom: spacing.md,
    fontWeight: '600',
  },
  errorHint: {
    color: colors.muted,
    fontSize: 14,
    textAlign: 'center',
  },
});
