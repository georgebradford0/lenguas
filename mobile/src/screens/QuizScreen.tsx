import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { Choice } from '../types';
import { colors, spacing } from '../styles/theme';
import { shuffle } from '../utils/shuffle';
import { getNextCard } from '../utils/weightedSelection';
import { useCards } from '../hooks/useCards';
import { useAudio } from '../hooks/useAudio';
import { useTranslation } from '../hooks/useTranslation';
import { StatsBar } from '../components/StatsBar';
import { WordCard } from '../components/WordCard';
import { ChoiceGrid } from '../components/ChoiceGrid';
import { DoneMessage } from '../components/DoneMessage';

const ADVANCE_DELAY = 1200;

export function QuizScreen() {
  const { cards, currentCard, loading, error, stats, processAnswer, nextCard } = useCards();
  const { playAudio, prefetchAudio } = useAudio();
  const { getTranslation, prefetchTranslation } = useTranslation();

  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [answered, setAnswered] = useState(false);

  // Load choices when current card changes
  useEffect(() => {
    if (!currentCard) {
      setChoices(null);
      return;
    }

    setChoices(null);
    setSelectedIndex(null);
    setAnswered(false);

    // Prefetch and play audio
    prefetchAudio(currentCard.word);
    playAudio(currentCard.word);

    // Load translation
    getTranslation(currentCard.word)
      .then((result) => {
        const options = shuffle([
          { text: result.translation, correct: true },
          { text: result.wrong[0], correct: false },
          { text: result.wrong[1], correct: false },
          { text: result.wrong[2], correct: false },
        ]);
        setChoices(options);
      })
      .catch((err) => {
        console.error('Failed to load translation:', err);
      });

    // Prefetch next card
    const next = getNextCard(cards, currentCard);
    if (next) {
      prefetchTranslation(next.word);
      prefetchAudio(next.word);
    }
  }, [currentCard, cards, prefetchAudio, playAudio, getTranslation, prefetchTranslation]);

  const handleSelect = useCallback(
    (index: number) => {
      if (answered || !choices) return;

      setSelectedIndex(index);
      setAnswered(true);

      const correct = choices[index].correct;
      processAnswer(correct);

      // Prefetch next card during delay
      const next = getNextCard(cards, currentCard);
      if (next) {
        prefetchTranslation(next.word);
        prefetchAudio(next.word);
      }

      // Auto-advance after delay
      setTimeout(() => {
        nextCard();
      }, ADVANCE_DELAY);
    },
    [answered, choices, cards, currentCard, processAnswer, nextCard, prefetchTranslation, prefetchAudio]
  );

  const handleSpeak = useCallback(() => {
    if (currentCard) {
      playAudio(currentCard.word);
    }
  }, [currentCard, playAudio]);

  if (loading) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  if (!currentCard) {
    return (
      <View style={styles.container}>
        <StatsBar {...stats} />
        <DoneMessage />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatsBar {...stats} />
      <View style={styles.content}>
        <WordCard word={currentCard.word} onSpeak={handleSpeak} />
        <ChoiceGrid
          choices={choices}
          selectedIndex={selectedIndex}
          answered={answered}
          onSelect={handleSelect}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
  },
  content: {
    flex: 1,
    width: '100%',
    maxWidth: 500,
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    flex: 1,
    color: colors.muted,
    fontSize: 16,
    textAlign: 'center',
    marginTop: spacing.xxl,
  },
  errorText: {
    flex: 1,
    color: colors.wrong,
    fontSize: 16,
    textAlign: 'center',
    marginTop: spacing.xxl,
  },
});
