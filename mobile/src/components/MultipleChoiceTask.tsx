import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { MultipleChoiceTaskData, Choice } from '../types';
import { shuffle } from '../utils/shuffle';
import { useAudio } from '../hooks/useAudio';
import { WordCard } from './WordCard';
import { ChoiceGrid } from './ChoiceGrid';

interface MultipleChoiceTaskProps {
  taskData: MultipleChoiceTaskData;
  onAnswer: (userAnswer: string, correctAnswer: string) => Promise<void>;
  onTaskReady?: () => void;
}

const ADVANCE_DELAY = 1200;

/**
 * Multiple choice task with dynamically generated content
 * Shows German text/phrase, user selects English translation
 */
export function MultipleChoiceTask({
  taskData,
  onAnswer,
  onTaskReady,
}: MultipleChoiceTaskProps) {
  const { playAudio, prefetchAudio } = useAudio();

  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [answered, setAnswered] = useState(false);
  const taskIdRef = useRef<string | null>(null);

  // Create unique ID for this task
  const taskId = `${taskData.german}-${taskData.correctEnglish}`;

  // Load choices when task changes
  useEffect(() => {
    // Skip if we already loaded this task
    if (taskIdRef.current === taskId) {
      return;
    }

    // Prefetch audio for German text
    prefetchAudio(taskData.german);

    // Create shuffled choices
    const options = shuffle([
      { text: taskData.correctEnglish, correct: true },
      { text: taskData.wrongOptions[0], correct: false },
      { text: taskData.wrongOptions[1], correct: false },
      { text: taskData.wrongOptions[2], correct: false },
    ]);

    // Update state
    setChoices(options);
    setSelectedIndex(null);
    setAnswered(false);
    taskIdRef.current = taskId;

    // Auto-play audio
    playAudio(taskData.german);

    // Notify parent
    onTaskReady?.();
  }, [taskId, taskData, prefetchAudio, playAudio, onTaskReady]);

  const handleSelect = useCallback(
    async (index: number) => {
      if (answered || !choices) return;

      setSelectedIndex(index);
      setAnswered(true);

      const userAnswer = choices[index].text;
      const correctAnswer = taskData.correctEnglish;

      // Auto-advance after delay
      setTimeout(async () => {
        taskIdRef.current = null; // Allow loading next task
        await onAnswer(userAnswer, correctAnswer);
      }, ADVANCE_DELAY);
    },
    [answered, choices, taskData.correctEnglish, onAnswer]
  );

  const handleSpeak = useCallback(() => {
    playAudio(taskData.german);
  }, [taskData.german, playAudio]);

  return (
    <>
      <WordCard word={taskData.german} onSpeak={handleSpeak} />
      <ChoiceGrid
        choices={choices}
        selectedIndex={selectedIndex}
        answered={answered}
        onSelect={handleSelect}
      />
    </>
  );
}
