import React, { useCallback, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Animated, useWindowDimensions } from 'react-native';
import { colors, spacing } from '../styles/theme';
import { useCards } from '../hooks/useCards';
import { StatsBar } from '../components/StatsBar';
import { MultipleChoiceTask } from '../components/MultipleChoiceTask';
import { ReverseTranslationTask } from '../components/ReverseTranslationTask';
import { AudioMultipleChoiceTask } from '../components/AudioMultipleChoiceTask';
import { SpeechRecognitionTask } from '../components/SpeechRecognitionTask';
import { TierUnlockCelebration } from '../components/TierUnlockCelebration';
import type { MultipleChoiceTaskData, ReverseTranslationTaskData, AudioMultipleChoiceTaskData, SpeechRecognitionTaskData, Language } from '../types';

/**
 * Main quiz screen with dynamic task generation
 */
export function QuizScreen({ language = 'de', onBack }: { language?: Language; onBack?: () => void }) {
  const { width: SCREEN_WIDTH } = useWindowDimensions();
  const {
    stats,
    currentTask,
    loading,
    error,
    taskLoading,
    submitting,
    tasksCompletedThisSession,
    levelJustUnlocked, // New level unlock
    tierJustUnlocked, // Legacy tier unlock (for compatibility)
    handleAnswer,
    loadNextTask,
    dismissLevelUnlock,
    dismissTierUnlock,
    levelStatsArray, // New level stats
    currentLevel, // New current level (A1/A2/B1)
    tierStatsArray, // Legacy tier stats
    currentTier, // Legacy current tier
    overallAccuracy,
    wordProgress,
    hasPreloadedTask,
  } = useCards(language);

  // Animation value for slide transition
  const slideAnim = useRef(new Animated.Value(0)).current;
  const taskIdRef = useRef<string | null>(null);

  // Animate in when task changes
  useEffect(() => {
    const currentTaskId = currentTask ? `${currentTask.targetWord}-${currentTask.tier}` : null;

    console.log('[QuizScreen] Animation effect - currentTaskId:', currentTaskId);
    console.log('[QuizScreen] Animation effect - taskIdRef.current:', taskIdRef.current);
    console.log('[QuizScreen] Animation effect - slideAnim._value:', slideAnim['_value']);

    if (currentTaskId && currentTaskId !== taskIdRef.current) {
      console.log('[QuizScreen] Starting slide-in animation');
      taskIdRef.current = currentTaskId;

      // Start from right side and slide in
      slideAnim.setValue(SCREEN_WIDTH);
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 65,
        friction: 10,
      }).start(() => {
        console.log('[QuizScreen] Slide-in animation complete');
      });
    } else {
      console.log('[QuizScreen] Skipping animation - task ID unchanged');
    }
  }, [currentTask, slideAnim]);

  // Handle answer submission with slide animation
  const onAnswerMultipleChoice = useCallback(
    async (userAnswer: string, correctAnswer: string) => {
      console.log('[QuizScreen] Starting slide-out animation (MC)');

      // Wait for slide-out animation to complete
      await new Promise<void>((resolve) => {
        Animated.timing(slideAnim, {
          toValue: -SCREEN_WIDTH,
          duration: 250,
          useNativeDriver: true,
        }).start(() => {
          console.log('[QuizScreen] Slide-out animation complete (MC)');
          resolve();
        });
      });

      // Reset task ID to allow slide-in animation for next task (even if same word)
      taskIdRef.current = null;
      console.log('[QuizScreen] Reset taskIdRef to allow next animation');

      // Submit answer and load next task AFTER animation completes
      await handleAnswer(userAnswer, correctAnswer);
      await loadNextTask();
    },
    [handleAnswer, loadNextTask, slideAnim]
  );

  const onAnswerReverseTranslation = useCallback(
    async (userAnswer: string, correctAnswer: string) => {
      console.log('[QuizScreen] Starting slide-out animation (RT)');

      // Wait for slide-out animation to complete
      await new Promise<void>((resolve) => {
        Animated.timing(slideAnim, {
          toValue: -SCREEN_WIDTH,
          duration: 250,
          useNativeDriver: true,
        }).start(() => {
          console.log('[QuizScreen] Slide-out animation complete (RT)');
          resolve();
        });
      });

      // Reset task ID to allow slide-in animation for next task (even if same word)
      taskIdRef.current = null;
      console.log('[QuizScreen] Reset taskIdRef to allow next animation');

      // Submit answer and load next task AFTER animation completes
      await handleAnswer(userAnswer, correctAnswer);
      await loadNextTask();
    },
    [handleAnswer, loadNextTask, slideAnim]
  );

  const onAnswerAudioMultipleChoice = useCallback(
    async (userAnswer: string, correctAnswer: string) => {
      console.log('[QuizScreen] Starting slide-out animation (Audio MC)');

      // Wait for slide-out animation to complete
      await new Promise<void>((resolve) => {
        Animated.timing(slideAnim, {
          toValue: -SCREEN_WIDTH,
          duration: 250,
          useNativeDriver: true,
        }).start(() => {
          console.log('[QuizScreen] Slide-out animation complete (Audio MC)');
          resolve();
        });
      });

      // Reset task ID to allow slide-in animation for next task (even if same word)
      taskIdRef.current = null;
      console.log('[QuizScreen] Reset taskIdRef to allow next animation');

      // Submit answer and load next task AFTER animation completes
      await handleAnswer(userAnswer, correctAnswer);
      await loadNextTask();
    },
    [handleAnswer, loadNextTask, slideAnim]
  );

  const onAnswerSpeechRecognition = useCallback(
    async (userAnswer: string, correctAnswer: string) => {
      console.log('[QuizScreen] Starting slide-out animation (Speech Recognition)');

      // Wait for slide-out animation to complete
      await new Promise<void>((resolve) => {
        Animated.timing(slideAnim, {
          toValue: -SCREEN_WIDTH,
          duration: 250,
          useNativeDriver: true,
        }).start(() => {
          console.log('[QuizScreen] Slide-out animation complete (Speech Recognition)');
          resolve();
        });
      });

      // Reset task ID to allow slide-in animation for next task (even if same word)
      taskIdRef.current = null;
      console.log('[QuizScreen] Reset taskIdRef to allow next animation');

      // Submit answer and load next task AFTER animation completes
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
          levelStats={levelStatsArray}
          currentLevel={currentLevel}
          tierStats={tierStatsArray}
          currentTier={currentTier}
          wordProgress={wordProgress}
          onBack={onBack}
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
            language={language}
          />
        );
      case 'reverseTranslation':
        return (
          <ReverseTranslationTask
            taskData={currentTask.task as ReverseTranslationTaskData}
            onAnswer={onAnswerReverseTranslation}
            language={language}
          />
        );
      case 'audioMultipleChoice':
        return (
          <AudioMultipleChoiceTask
            taskData={currentTask.task as AudioMultipleChoiceTaskData}
            onAnswer={onAnswerAudioMultipleChoice}
            language={language}
          />
        );
      case 'speechRecognition':
        return (
          <SpeechRecognitionTask
            key={`${currentTask.targetWord}-${currentTask.taskType}`}
            taskData={currentTask.task as SpeechRecognitionTaskData}
            onAnswer={onAnswerSpeechRecognition}
            language={language}
          />
        );
      default:
        return <Text style={styles.errorText}>Unknown task type: {currentTask.taskType}</Text>;
    }
  };

  return (
    <View style={styles.container}>
      <StatsBar
        accuracy={overallAccuracy}
        levelStats={levelStatsArray}
        currentLevel={currentLevel}
        tierStats={tierStatsArray}
        currentTier={currentTier}
        wordProgress={wordProgress}
        onBack={onBack}
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

      {/* Level/Tier unlock celebration overlay */}
      {(levelJustUnlocked || tierJustUnlocked) && (
        <TierUnlockCelebration
          tier={tierJustUnlocked || (levelJustUnlocked === 'A1' ? 1 : levelJustUnlocked === 'A2' ? 2 : 3)}
          onDismiss={dismissLevelUnlock || dismissTierUnlock}
        />
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
