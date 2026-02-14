import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { ReverseTranslationTaskData, Choice } from '../types';
import { colors, spacing, fontSize, borderRadius } from '../styles/theme';
import { shuffle } from '../utils/shuffle';
import { useAudio } from '../hooks/useAudio';
import { ChoiceGrid } from './ChoiceGrid';

interface ReverseTranslationTaskProps {
  taskData: ReverseTranslationTaskData;
  onAnswer: (userAnswer: string, correctAnswer: string) => Promise<void>;
  onTaskReady?: () => void;
}

const PAUSE_AFTER_AUDIO = 500;

/**
 * Reverse translation task with dynamically generated content
 * Shows English text, user selects German translation
 */
export function ReverseTranslationTask({
  taskData,
  onAnswer,
  onTaskReady,
}: ReverseTranslationTaskProps) {
  const { playAudio } = useAudio();

  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [answered, setAnswered] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const taskIdRef = useRef<string | null>(null);

  // Create unique ID for this task
  const taskId = `${taskData.english}-${taskData.correctGerman}`;

  // Load choices when task changes
  useEffect(() => {
    console.log('[ReverseTranslation] Loading task:', taskId);
    console.log('[ReverseTranslation] Task data:', JSON.stringify(taskData, null, 2));

    // Skip if we already loaded this task
    if (taskIdRef.current === taskId) {
      console.log('[ReverseTranslation] Task already loaded, skipping');
      return;
    }

    // Validate task data
    if (!taskData.wrongOptions || taskData.wrongOptions.length < 3) {
      console.error('[ReverseTranslation] Invalid task data: missing wrongOptions', taskData);
      setChoices(null);
      setValidationError('Task data is incomplete. Please try again.');
      taskIdRef.current = taskId; // Mark as processed to avoid retry loops
      return;
    }

    // Validate that all options have text
    const hasValidOptions = taskData.correctGerman &&
                           taskData.wrongOptions.every(opt => opt && typeof opt === 'string');

    if (!hasValidOptions) {
      console.error('[ReverseTranslation] Invalid task data: empty or invalid options', taskData);
      setChoices(null);
      setValidationError('Task options are invalid. Please try again.');
      taskIdRef.current = taskId;
      return;
    }

    console.log('[ReverseTranslation] Validation passed, creating choices');
    // Clear any previous validation errors
    setValidationError(null);

    // Create shuffled choices with German words
    const options = shuffle([
      { text: taskData.correctGerman, correct: true },
      { text: taskData.wrongOptions[0], correct: false },
      { text: taskData.wrongOptions[1], correct: false },
      { text: taskData.wrongOptions[2], correct: false },
    ]);

    // Update state
    setChoices(options);
    setSelectedIndex(null);
    setAnswered(false);
    taskIdRef.current = taskId;

    // Notify parent
    onTaskReady?.();
  }, [taskId, taskData, onTaskReady]);

  const handleSelect = useCallback(
    async (index: number) => {
      if (answered || !choices) return;

      setSelectedIndex(index);
      setAnswered(true);

      const userAnswer = choices[index].text;
      const correctAnswer = taskData.correctGerman;

      // Always play audio of the correct German word/phrase for learning (use audio version)
      await playAudio(taskData.correctGermanAudio || taskData.correctGerman);

      // Short pause after audio finishes
      await new Promise((resolve) => setTimeout(resolve, PAUSE_AFTER_AUDIO));

      // Advance to next task
      taskIdRef.current = null;
      await onAnswer(userAnswer, correctAnswer);
    },
    [answered, choices, taskData.correctGerman, onAnswer, playAudio]
  );

  console.log('[ReverseTranslation] Render - validationError:', validationError);
  console.log('[ReverseTranslation] Render - choices:', choices ? 'exists' : 'null');
  console.log('[ReverseTranslation] Render - english:', taskData.english);

  // Show error if validation failed
  if (validationError) {
    console.log('[ReverseTranslation] Rendering error state');
    return (
      <>
        <View style={styles.promptContainer}>
          <Text style={styles.promptLabel}>Error</Text>
          <Text style={[styles.englishWord, { color: colors.wrong }]}>{validationError}</Text>
        </View>
      </>
    );
  }

  if (!choices) {
    console.log('[ReverseTranslation] Rendering loading state');
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  console.log('[ReverseTranslation] Rendering normal state');
  return (
    <>
      <View style={styles.promptContainer}>
        <Text style={styles.promptLabel}>Select the German translation for:</Text>
        <Text style={styles.englishWord}>{taskData.english}</Text>
      </View>
      <ChoiceGrid
        choices={choices}
        selectedIndex={selectedIndex}
        answered={answered}
        onSelect={handleSelect}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
  },
  promptContainer: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
    backgroundColor: colors.cardBackground,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
    width: '100%',
    minHeight: 180,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  promptLabel: {
    fontSize: fontSize.md,
    color: colors.muted,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  englishWord: {
    fontSize: fontSize.word,
    fontWeight: 'bold',
    color: colors.text,
    textAlign: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: colors.muted,
  },
});
