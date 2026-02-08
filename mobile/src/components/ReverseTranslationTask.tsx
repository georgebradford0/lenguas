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
  const taskIdRef = useRef<string | null>(null);

  // Create unique ID for this task
  const taskId = `${taskData.english}-${taskData.correctGerman}`;

  // Load choices when task changes
  useEffect(() => {
    // Skip if we already loaded this task
    if (taskIdRef.current === taskId) {
      return;
    }

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

      // Always play audio of the correct German word/phrase for learning
      await playAudio(taskData.correctGerman);

      // Short pause after audio finishes
      await new Promise((resolve) => setTimeout(resolve, PAUSE_AFTER_AUDIO));

      // Advance to next task
      taskIdRef.current = null;
      await onAnswer(userAnswer, correctAnswer);
    },
    [answered, choices, taskData.correctGerman, onAnswer, playAudio]
  );

  if (!choices) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

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
