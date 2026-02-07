import { useState, useCallback, useEffect } from 'react';
import type {
  GenerateTaskResponse,
  SubmitAnswerResponse,
  TierProgress,
  TaskType,
} from '../types';
import { generateTask, submitAnswer, getTierProgress } from '../api/client';

/**
 * Hook for tier-based learning with dynamic task generation
 */
export function useCards(userId?: string) {
  const [progress, setProgress] = useState<TierProgress | null>(null);
  const [currentTask, setCurrentTask] = useState<GenerateTaskResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [taskLoading, setTaskLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [tasksCompletedThisSession, setTasksCompletedThisSession] = useState(0);
  const [tierJustUnlocked, setTierJustUnlocked] = useState<number | null>(null);

  // Load initial tier progress
  useEffect(() => {
    async function init() {
      try {
        const tierProgress = await getTierProgress(userId);
        setProgress(tierProgress);
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load progress');
        setLoading(false);
      }
    }
    init();
  }, [userId]);

  // Get task type based on tier (weighted selection)
  const selectTaskType = useCallback((tier: number): TaskType => {
    const tierWeights: Record<number, { multipleChoice: number; reverseTranslation: number }> = {
      1: { multipleChoice: 0.8, reverseTranslation: 0.2 },
      2: { multipleChoice: 0.6, reverseTranslation: 0.4 },
      3: { multipleChoice: 0.4, reverseTranslation: 0.6 },
      4: { multipleChoice: 0.3, reverseTranslation: 0.7 },
    };

    const weights = tierWeights[tier] || tierWeights[1];
    return Math.random() < weights.multipleChoice ? 'multipleChoice' : 'reverseTranslation';
  }, []);

  // Load next task
  const loadNextTask = useCallback(async () => {
    if (!progress) return;

    setTaskLoading(true);
    setError(null);

    try {
      const taskType = selectTaskType(progress.currentTier);
      const task = await generateTask(progress.currentTier, taskType);
      setCurrentTask(task);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate task');
    } finally {
      setTaskLoading(false);
    }
  }, [progress, selectTaskType]);

  // Load first task after progress is loaded
  useEffect(() => {
    if (progress && !currentTask && !taskLoading) {
      loadNextTask();
    }
  }, [progress, currentTask, taskLoading, loadNextTask]);

  // Submit answer and load next task
  const handleAnswer = useCallback(
    async (userAnswer: string, correctAnswer: string) => {
      if (!currentTask || submitting) return;

      setSubmitting(true);
      setTierJustUnlocked(null);

      try {
        const result = await submitAnswer({
          userId,
          tier: currentTask.tier,
          taskType: currentTask.taskType,
          userAnswer,
          correctAnswer,
          taskData: currentTask.task,
        });

        // Update local progress
        setProgress((prev) => {
          if (!prev) return null;

          const tierKey = `tier${currentTask.tier}` as keyof typeof prev.tierStats;
          const tierStats = { ...prev.tierStats[tierKey] };

          tierStats.totalAttempts = result.stats.totalAttempts;
          tierStats.correctAttempts = result.stats.correctAttempts;

          return {
            ...prev,
            currentTier: result.currentTier,
            tierStats: {
              ...prev.tierStats,
              [tierKey]: tierStats,
            },
            overallAccuracy: result.stats.overallAccuracy,
            totalTasksCompleted: prev.totalTasksCompleted + 1,
          };
        });

        // Track tier unlock
        if (result.tierUnlocked) {
          setTierJustUnlocked(result.currentTier);
        }

        // Track session stats
        setTasksCompletedThisSession((prev) => prev + 1);

        return result;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to submit answer');
        throw err;
      } finally {
        setSubmitting(false);
      }
    },
    [currentTask, submitting, userId]
  );

  // Dismiss tier unlock celebration
  const dismissTierUnlock = useCallback(() => {
    setTierJustUnlocked(null);
  }, []);

  // Calculate tier stats for display
  const tierStatsArray = progress
    ? ([1, 2, 3, 4] as const).map((tier) => {
        const tierKey = `tier${tier}` as keyof typeof progress.tierStats;
        const stats = progress.tierStats[tierKey];
        const accuracy = stats.totalAttempts > 0 ? stats.correctAttempts / stats.totalAttempts : 0;

        return {
          tier,
          unlocked: stats.unlocked,
          totalAttempts: stats.totalAttempts,
          accuracy: Math.round(accuracy * 100),
          progressToUnlock:
            tier === progress.currentTier
              ? Math.min(100, Math.round((stats.totalAttempts / 20) * 100))
              : 100,
        };
      })
    : [];

  return {
    // State
    progress,
    currentTask,
    loading,
    error,
    taskLoading,
    submitting,
    tasksCompletedThisSession,
    tierJustUnlocked,

    // Actions
    handleAnswer,
    loadNextTask,
    dismissTierUnlock,

    // Computed stats
    tierStatsArray,
    currentTier: progress?.currentTier || 1,
    overallAccuracy: progress?.overallAccuracy || 0,
  };
}
