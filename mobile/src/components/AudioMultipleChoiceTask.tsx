import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text } from 'react-native';
import type { AudioMultipleChoiceTaskData, Choice } from '../types';
import { shuffle } from '../utils/shuffle';
import { useAudio } from '../hooks/useAudio';
import { AudioCard } from './AudioCard';
import { ChoiceGrid } from './ChoiceGrid';

interface AudioMultipleChoiceTaskProps {
  taskData: AudioMultipleChoiceTaskData;
  onAnswer: (userAnswer: string, correctAnswer: string) => Promise<void>;
  onTaskReady?: () => void;
}

const ADVANCE_DELAY = 1200;

/**
 * Audio-only multiple choice task
 * Plays German audio, user selects English translation (no visual German text)
 */
export function AudioMultipleChoiceTask({
  taskData,
  onAnswer,
  onTaskReady,
}: AudioMultipleChoiceTaskProps) {
  const { playAudio, prefetchAudio } = useAudio();

  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [answered, setAnswered] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const taskIdRef = useRef<string | null>(null);

  // Create unique ID for this task
  const taskId = `${taskData.germanAudio}-${taskData.correctEnglish}`;

  // Load choices when task changes
  useEffect(() => {
    console.log('[AudioMultipleChoice] Loading task:', taskId);
    console.log('[AudioMultipleChoice] Task data:', JSON.stringify(taskData, null, 2));

    // Skip if we already loaded this task
    if (taskIdRef.current === taskId) {
      console.log('[AudioMultipleChoice] Task already loaded, skipping');
      return;
    }

    // Validate task data
    if (!taskData.wrongOptions || taskData.wrongOptions.length < 3) {
      console.error('[AudioMultipleChoice] Invalid task data: missing wrongOptions', taskData);
      setChoices(null);
      setValidationError('Task data is incomplete. Please try again.');
      taskIdRef.current = taskId;
      return;
    }

    // Validate that all options have text
    const hasValidOptions = taskData.correctEnglish &&
                           taskData.wrongOptions.every(opt => opt && typeof opt === 'string');

    if (!hasValidOptions) {
      console.error('[AudioMultipleChoice] Invalid task data: empty or invalid options', taskData);
      setChoices(null);
      setValidationError('Task options are invalid. Please try again.');
      taskIdRef.current = taskId;
      return;
    }

    console.log('[AudioMultipleChoice] Validation passed, creating choices');
    // Clear any previous validation errors
    setValidationError(null);

    // Prefetch audio for German word
    prefetchAudio(taskData.germanAudio);

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

    // Auto-play audio after successful validation
    playAudio(taskData.germanAudio);

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
    playAudio(taskData.germanAudio);
  }, [taskData.germanAudio, playAudio]);

  console.log('[AudioMultipleChoice] Render - validationError:', validationError);
  console.log('[AudioMultipleChoice] Render - choices:', choices ? 'exists' : 'null');

  // Show error if validation failed
  if (validationError) {
    console.log('[AudioMultipleChoice] Rendering error state');
    return (
      <>
        <AudioCard onSpeak={handleSpeak} />
        <View style={{ padding: 20, alignItems: 'center' }}>
          <Text style={{ color: '#e74c3c', fontSize: 16, textAlign: 'center' }}>
            {validationError}
          </Text>
        </View>
      </>
    );
  }

  console.log('[AudioMultipleChoice] Rendering normal state');
  return (
    <>
      <AudioCard onSpeak={handleSpeak} />
      <ChoiceGrid
        choices={choices}
        selectedIndex={selectedIndex}
        answered={answered}
        onSelect={handleSelect}
      />
    </>
  );
}
