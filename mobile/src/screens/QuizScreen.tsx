import React, { useCallback, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing } from '../styles/theme';
import { getNextCard } from '../utils/weightedSelection';
import { useCards } from '../hooks/useCards';
import { useAudio } from '../hooks/useAudio';
import { useTranslation } from '../hooks/useTranslation';
import { StatsBar } from '../components/StatsBar';
import { MultipleChoiceTask } from '../components/MultipleChoiceTask';
import { DoneMessage } from '../components/DoneMessage';

export function QuizScreen() {
  const { cards, currentCard, loading, error, stats, processAnswer, nextCard } = useCards();
  const { prefetchAudio } = useAudio();
  const { prefetchTranslation } = useTranslation();
  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  const handleAnswer = useCallback(
    (correct: boolean) => {
      processAnswer(correct);
      nextCard();
    },
    [processAnswer, nextCard]
  );

  const handleCardReady = useCallback(() => {
    // Prefetch next card
    if (currentCard) {
      const next = getNextCard(cardsRef.current, currentCard);
      if (next) {
        prefetchTranslation(next.word);
        prefetchAudio(next.word);
      }
    }
  }, [currentCard, prefetchTranslation, prefetchAudio]);

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
        <MultipleChoiceTask
          card={currentCard}
          onAnswer={handleAnswer}
          onCardReady={handleCardReady}
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
