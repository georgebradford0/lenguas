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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [taskLoading, setTaskLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [tasksCompletedThisSession, setTasksCompletedThisSession] = useState(0);

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

  // Load next task
  const loadNextTask = useCallback(async () => {
    if (!stats) return;

    setTaskLoading(true);
    setError(null);

    try {
      const taskType = selectTaskType(stats.currentTier);
      const task = await generateTask(stats.currentTier, taskType);
      setCurrentTask(task);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate task');
    } finally {
      setTaskLoading(false);
    }
  }, [stats, selectTaskType]);

  // Load first task after stats are loaded
  useEffect(() => {
    if (stats && !currentTask && !taskLoading) {
      loadNextTask();
    }
  }, [stats, currentTask, taskLoading, loadNextTask]);

  // Submit answer and load next task
  const handleAnswer = useCallback(
    async (userAnswer: string, correctAnswer: string) => {
      if (!currentTask || submitting) return;

      setSubmitting(true);

      try {
        const result = await submitAnswer({
          targetWord: currentTask.targetWord,
          tier: currentTask.tier,
          taskType: currentTask.taskType,
          userAnswer,
          correctAnswer,
        });

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
    [currentTask, submitting]
  );

  return {
    // State
    stats,
    currentTask,
    loading,
    error,
    taskLoading,
    submitting,
    tasksCompletedThisSession,

    // Actions
    handleAnswer,
    loadNextTask,

    // Computed stats
    tierStatsArray: stats?.tierStats || [],
    currentTier: stats?.currentTier || 1,
    overallAccuracy: stats?.overallAccuracy || 0,
  };
}
