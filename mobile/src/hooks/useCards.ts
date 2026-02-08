import { useState, useCallback, useEffect } from 'react';
import type {
  GenerateTaskResponse,
  SubmitAnswerResponse,
  TierStatsResponse,
  TaskType,
} from '../types';
import { generateTask, submitAnswer, getTierStats } from '../api/client';

/**
 * Hook for tier-based learning with dynamic task generation
 */
export function useCards(userId?: string) {
  const [stats, setStats] = useState<TierStatsResponse | null>(null);
  const [currentTask, setCurrentTask] = useState<GenerateTaskResponse | null>(null);
  const [nextTask, setNextTask] = useState<GenerateTaskResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [taskLoading, setTaskLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [tasksCompletedThisSession, setTasksCompletedThisSession] = useState(0);
  const [tierJustUnlocked, setTierJustUnlocked] = useState<number | null>(null);
  const [preloading, setPreloading] = useState(false);

  // Load initial tier stats
  useEffect(() => {
    async function init() {
      try {
        const tierStats = await getTierStats();
        setStats(tierStats);
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load stats');
        setLoading(false);
      }
    }
    init();
  }, []);

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

  // Preload next task in background
  const preloadNextTask = useCallback(async () => {
    if (!stats || preloading) return;

    setPreloading(true);
    try {
      const taskType = selectTaskType(stats.currentTier);
      const task = await generateTask(stats.currentTier, taskType);
      setNextTask(task);
    } catch (err) {
      console.warn('Failed to preload next task:', err);
    } finally {
      setPreloading(false);
    }
  }, [stats, selectTaskType, preloading]);

  // Advance to preloaded task (or load if not preloaded)
  const loadNextTask = useCallback(async () => {
    if (!stats) return;

    // If we have a preloaded task, use it immediately
    if (nextTask) {
      setCurrentTask(nextTask);
      setNextTask(null);
      // Start preloading the next one
      setTimeout(() => preloadNextTask(), 100);
      return;
    }

    // Otherwise load normally (fallback for initial load)
    setTaskLoading(true);
    setError(null);

    try {
      const taskType = selectTaskType(stats.currentTier);
      const task = await generateTask(stats.currentTier, taskType);
      setCurrentTask(task);
      // Start preloading the next one
      setTimeout(() => preloadNextTask(), 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate task');
    } finally {
      setTaskLoading(false);
    }
  }, [stats, selectTaskType, nextTask, preloadNextTask]);

  // Load first task after stats are loaded
  useEffect(() => {
    if (stats && !currentTask && !taskLoading) {
      loadNextTask();
    }
  }, [stats, currentTask, taskLoading, loadNextTask]);

  // Submit answer and load next task
  const handleAnswer = useCallback(
    async (userAnswer: string, correctAnswer: string) => {
      if (!currentTask || submitting || !stats) return;

      setSubmitting(true);

      try {
        const result = await submitAnswer({
          targetWord: currentTask.targetWord,
          tier: currentTask.tier,
          taskType: currentTask.taskType,
          userAnswer,
          correctAnswer,
          previousTier: stats.currentTier,
        });

        // Check for tier unlock
        if (result.tierUnlocked && result.newTier) {
          setTierJustUnlocked(result.newTier);
        }

        // Reload stats after answer
        const updatedStats = await getTierStats();
        setStats(updatedStats);

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
    [currentTask, submitting, stats]
  );

  // Dismiss tier unlock celebration
  const dismissTierUnlock = useCallback(() => {
    setTierJustUnlocked(null);
  }, []);

  return {
    // State
    stats,
    currentTask,
    nextTask,
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
    tierStatsArray: stats?.tierStats || [],
    currentTier: stats?.currentTier || 1,
    overallAccuracy: stats?.overallAccuracy || 0,
    hasPreloadedTask: nextTask !== null,
  };
}
