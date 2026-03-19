import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text } from 'react-native';
import type { MultipleChoiceTaskData, Choice, Language } from '../types';
import { shuffle } from '../utils/shuffle';
import { useAudio } from '../hooks/useAudio';
import { WordCard } from './WordCard';
import { ChoiceGrid } from './ChoiceGrid';

interface MultipleChoiceTaskProps {
  taskData: MultipleChoiceTaskData;
  onAnswer: (userAnswer: string, correctAnswer: string) => Promise<void>;
  onTaskReady?: () => void;
  language?: Language;
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
  language = 'de',
}: MultipleChoiceTaskProps) {
  const { playAudio, prefetchAudio, clearAudio } = useAudio(language);

  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [answered, setAnswered] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const taskIdRef = useRef<string | null>(null);

  // Create unique ID for this task
  const taskId = `${taskData.german}-${taskData.correctEnglish}`;

  // Load choices when task changes
  useEffect(() => {
    console.log('[MultipleChoice] Loading task:', taskId);
    console.log('[MultipleChoice] Task data:', JSON.stringify(taskData, null, 2));

    // Skip if we already loaded this task
    if (taskIdRef.current === taskId) {
      console.log('[MultipleChoice] Task already loaded, skipping');
      return;
    }

    // Validate task data
    if (!taskData.wrongOptions || taskData.wrongOptions.length < 3) {
      console.error('[MultipleChoice] Invalid task data: missing wrongOptions', taskData);
      setChoices(null);
      setValidationError('Task data is incomplete. Please try again.');
      taskIdRef.current = taskId; // Mark as processed to avoid retry loops
      return;
    }

    // Validate that all options have text
    const hasValidOptions = taskData.correctEnglish &&
                           taskData.wrongOptions.every(opt => opt && typeof opt === 'string');

    if (!hasValidOptions) {
      console.error('[MultipleChoice] Invalid task data: empty or invalid options', taskData);
      setChoices(null);
      setValidationError('Task options are invalid. Please try again.');
      taskIdRef.current = taskId;
      return;
    }

    console.log('[MultipleChoice] Validation passed, creating choices');
    // Clear any previous validation errors
    setValidationError(null);

    // Prefetch audio for the upcoming task word
    prefetchAudio(taskData.germanAudio || taskData.german);

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

    // Auto-play audio only after successful validation (use audio version)
    playAudio(taskData.germanAudio || taskData.german);

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
        clearAudio(taskData.germanAudio || taskData.german);
        taskIdRef.current = null; // Allow loading next task
        await onAnswer(userAnswer, correctAnswer);
      }, ADVANCE_DELAY);
    },
    [answered, choices, taskData.correctEnglish, taskData.germanAudio, taskData.german, clearAudio, onAnswer]
  );

  const handleSpeak = useCallback(() => {
    // Use audio version without plural notation
    playAudio(taskData.germanAudio || taskData.german);
  }, [taskData.germanAudio, taskData.german, playAudio]);

  console.log('[MultipleChoice] Render - validationError:', validationError);
  console.log('[MultipleChoice] Render - choices:', choices ? 'exists' : 'null');
  console.log('[MultipleChoice] Render - german word:', taskData.german);

  // Show error if validation failed
  if (validationError) {
    console.log('[MultipleChoice] Rendering error state');
    return (
      <>
        <WordCard word={taskData.german || 'Error'} onSpeak={handleSpeak} />
        <View style={{ padding: 20, alignItems: 'center' }}>
          <Text style={{ color: '#e74c3c', fontSize: 16, textAlign: 'center' }}>
            {validationError}
          </Text>
        </View>
      </>
    );
  }

  console.log('[MultipleChoice] Rendering normal state');
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
