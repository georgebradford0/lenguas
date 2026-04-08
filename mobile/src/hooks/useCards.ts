import { useState, useCallback, useEffect } from 'react';
import type {
  GenerateTaskResponse,
  SubmitAnswerResponse,
  LevelStatsResponse,
  TaskType,
  Level,
  Language,
} from '../types';
import { generateTask, submitAnswer, getLevelStats, blockWord as blockWordApi } from '../api/client';

/**
 * Hook for level-based learning (A1/A2/B1) with simple word translation tasks
 */
export function useCards(language: Language = 'de', userId?: string) {
  const [stats, setStats] = useState<LevelStatsResponse | null>(null);
  const [currentTask, setCurrentTask] = useState<GenerateTaskResponse | null>(null);
  const [nextTask, setNextTask] = useState<GenerateTaskResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [taskLoading, setTaskLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [tasksCompletedThisSession, setTasksCompletedThisSession] = useState(0);
  const [levelJustUnlocked, setLevelJustUnlocked] = useState<Level | null>(null);
  const [preloading, setPreloading] = useState(false);

  // Load initial level stats
  useEffect(() => {
    async function init() {
      try {
        const levelStats = await getLevelStats(language);
        setStats(levelStats);
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load stats');
        setLoading(false);
      }
    }
    init();
  }, [language]);

  // Get task type based on level (weighted selection)
  const selectTaskType = useCallback((level: Level): TaskType => {
    const levelWeights: Record<Level, { multipleChoice: number; reverseTranslation: number; audioMultipleChoice: number; speechRecognition: number }> = {
      A1: { multipleChoice: 0.4, reverseTranslation: 0.1, audioMultipleChoice: 0.2, speechRecognition: 0.3 },
      A2: { multipleChoice: 0.25, reverseTranslation: 0.25, audioMultipleChoice: 0.2, speechRecognition: 0.3 },
      B1: { multipleChoice: 0.2, reverseTranslation: 0.3, audioMultipleChoice: 0.2, speechRecognition: 0.3 },
    };

    const weights = levelWeights[level] || levelWeights.A1;
    const random = Math.random();

    // Cumulative probability selection
    let cumulative = 0;

    cumulative += weights.multipleChoice;
    if (random < cumulative) {
      return 'multipleChoice';
    }

    cumulative += weights.reverseTranslation;
    if (random < cumulative) {
      return 'reverseTranslation';
    }

    cumulative += weights.audioMultipleChoice;
    if (random < cumulative) {
      return 'audioMultipleChoice';
    }

    return 'speechRecognition';
  }, []);

  // Preload next task in background
  const preloadNextTask = useCallback(async () => {
    if (!stats || preloading) return;

    setPreloading(true);
    try {
      const taskType = selectTaskType(stats.currentLevel);
      const task = await generateTask(stats.currentLevel, taskType, language);
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
      const taskType = selectTaskType(stats.currentLevel);
      const task = await generateTask(stats.currentLevel, taskType, language);
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
          level: currentTask.level,
          taskType: currentTask.taskType,
          userAnswer,
          correctAnswer,
          previousLevel: stats.currentLevel,
          language,
        });

        // Check for level unlock
        if (result.levelUnlocked && result.newLevel) {
          setLevelJustUnlocked(result.newLevel);
        }

        // Reload stats after answer
        const updatedStats = await getLevelStats(language);
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

  // Block current word — excludes it from future tasks and level totals
  const blockWord = useCallback(async () => {
    if (!currentTask || !stats) return;
    await blockWordApi(currentTask.targetWord, currentTask.level, language);
    const updatedStats = await getLevelStats(language);
    setStats(updatedStats);
  }, [currentTask, stats, language]);

  // Dismiss level unlock celebration
  const dismissLevelUnlock = useCallback(() => {
    setLevelJustUnlocked(null);
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
    levelJustUnlocked, // Changed from tierJustUnlocked

    // Actions
    handleAnswer,
    loadNextTask,
    blockWord,
    dismissLevelUnlock, // Changed from dismissTierUnlock

    // Computed stats
    levelStatsArray: stats?.levelStats || [],
    currentLevel: stats?.currentLevel || 'A1',
    overallAccuracy: stats?.overallAccuracy || 0,
    wordProgress: stats?.wordProgress || [],
    hasPreloadedTask: nextTask !== null,

    // Legacy tier compatibility
    tierJustUnlocked: levelJustUnlocked ?
      (levelJustUnlocked === 'A1' ? 1 : levelJustUnlocked === 'A2' ? 2 : 3) : null,
    dismissTierUnlock: dismissLevelUnlock,
    currentTier: stats?.currentLevel === 'A1' ? 1 : stats?.currentLevel === 'A2' ? 2 : 3,
    tierStatsArray: stats?.levelStats || [],
  };
}
