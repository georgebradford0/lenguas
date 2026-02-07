import React, { useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { colors, spacing } from '../styles/theme';
import { useCards } from '../hooks/useCards';
import { StatsBar } from '../components/StatsBar';
import { MultipleChoiceTask } from '../components/MultipleChoiceTask';
import { ReverseTranslationTask } from '../components/ReverseTranslationTask';
import { TierUnlockCelebration } from '../components/TierUnlockCelebration';
import type { MultipleChoiceTaskData, ReverseTranslationTaskData } from '../types';

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
  } = useCards();

  // Handle answer submission
  const onAnswerMultipleChoice = useCallback(
    async (userAnswer: string, correctAnswer: string) => {
      await handleAnswer(userAnswer, correctAnswer);
      await loadNextTask();
    },
    [handleAnswer, loadNextTask]
  );

  const onAnswerReverseTranslation = useCallback(
    async (userAnswer: string, correctAnswer: string) => {
      await handleAnswer(userAnswer, correctAnswer);
      await loadNextTask();
    },
    [handleAnswer, loadNextTask]
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
        {submitting ? (
          <View style={styles.centerContent}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Checking answer...</Text>
          </View>
        ) : (
          renderTask()
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
