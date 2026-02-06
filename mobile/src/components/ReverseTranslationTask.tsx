import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { Card, Choice } from '../types';
import { colors, spacing } from '../styles/theme';
import { shuffle } from '../utils/shuffle';
import { useTranslation } from '../hooks/useTranslation';
import { ChoiceGrid } from './ChoiceGrid';

interface ReverseTranslationTaskProps {
  card: Card;
  allWords: string[]; // All available German words for wrong choices
  onAnswer: (correct: boolean) => void;
  onCardReady?: () => void;
}

const ADVANCE_DELAY = 1200;

export function ReverseTranslationTask({
  card,
  allWords,
  onAnswer,
  onCardReady
}: ReverseTranslationTaskProps) {
  const { getTranslation } = useTranslation();

  const [englishWord, setEnglishWord] = useState<string | null>(null);
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [answered, setAnswered] = useState(false);
  const loadedWordRef = useRef<string | null>(null);

  // Load translation and create choices when card changes
  useEffect(() => {
    if (!card) {
      setChoices(null);
      setEnglishWord(null);
      loadedWordRef.current = null;
      return;
    }

    // Skip if we already loaded this word
    if (loadedWordRef.current === card.word) {
      return;
    }

    // Load translation
    getTranslation(card.word)
      .then((result) => {
        // Pick 3 random other German words as wrong choices
        const otherWords = allWords.filter((w) => w !== card.word);
        const wrongWords: string[] = [];
        const shuffled = [...otherWords].sort(() => Math.random() - 0.5);

        for (let i = 0; i < Math.min(3, shuffled.length); i++) {
          wrongWords.push(shuffled[i]);
        }

        // Create choices with German words
        const options = shuffle([
          { text: card.word, correct: true },
          { text: wrongWords[0] || 'Option1', correct: false },
          { text: wrongWords[1] || 'Option2', correct: false },
          { text: wrongWords[2] || 'Option3', correct: false },
        ]);

        // Update all state together to avoid flicker
        setEnglishWord(result.translation);
        setChoices(options);
        setSelectedIndex(null);
        setAnswered(false);
        loadedWordRef.current = card.word;

        // Notify parent that card is ready
        onCardReady?.();
      })
      .catch((err) => {
        console.error('Failed to load translation:', err);
      });
  }, [card, allWords, getTranslation, onCardReady]);

  const handleSelect = useCallback(
    (index: number) => {
      if (answered || !choices) return;

      setSelectedIndex(index);
      setAnswered(true);

      const correct = choices[index].correct;

      // Auto-advance after delay
      setTimeout(() => {
        loadedWordRef.current = null; // Allow loading next card
        onAnswer(correct);
      }, ADVANCE_DELAY);
    },
    [answered, choices, onAnswer]
  );

  if (!englishWord || !choices) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.promptContainer}>
        <Text style={styles.promptLabel}>Select the German word for:</Text>
        <Text style={styles.englishWord}>{englishWord}</Text>
      </View>
      <ChoiceGrid
        choices={choices}
        selectedIndex={selectedIndex}
        answered={answered}
        onSelect={handleSelect}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  promptContainer: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  promptLabel: {
    fontSize: 16,
    color: colors.muted,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  englishWord: {
    fontSize: 48,
    fontWeight: 'bold',
    color: colors.text,
    textAlign: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: colors.muted,
  },
});
