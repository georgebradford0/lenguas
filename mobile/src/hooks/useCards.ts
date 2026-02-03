import { useState, useCallback, useEffect } from 'react';
import type { Card } from '../types';
import { loadWords, loadProgress, saveProgress } from '../api/client';
import { getNextCard } from '../utils/weightedSelection';

export function useCards() {
  const [cards, setCards] = useState<Card[]>([]);
  const [currentCard, setCurrentCard] = useState<Card | null>(null);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      try {
        const [words, progress] = await Promise.all([loadWords(), loadProgress()]);
        const initialCards = words.map((word) => {
          const saved = progress[word];
          if (saved && typeof saved.timesShown === 'number') {
            return { word, ...saved };
          }
          return { word, timesShown: 0, correctCount: 0 };
        });
        setCards(initialCards);
        setCurrentCard(getNextCard(initialCards, null));
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to initialize');
        setLoading(false);
      }
    }
    init();
  }, []);

  const processAnswer = useCallback(
    (correct: boolean) => {
      if (!currentCard) return;

      const updatedCard = {
        ...currentCard,
        timesShown: currentCard.timesShown + 1,
        correctCount: currentCard.correctCount + (correct ? 1 : 0),
      };

      setCards((prev) => prev.map((c) => (c.word === currentCard.word ? updatedCard : c)));
      setReviewedCount((prev) => prev + 1);

      // Save progress to API
      saveProgress(currentCard.word, {
        timesShown: updatedCard.timesShown,
        correctCount: updatedCard.correctCount,
      }).catch(console.error);

      return updatedCard;
    },
    [currentCard]
  );

  const nextCard = useCallback(() => {
    setCurrentCard((prev) => getNextCard(cards, prev));
  }, [cards]);

  const stats = {
    total: cards.length,
    unseen: cards.filter((c) => c.timesShown === 0).length,
    reviewed: reviewedCount,
    accuracy:
      cards.reduce((s, c) => s + c.timesShown, 0) > 0
        ? Math.round(
            (100 * cards.reduce((s, c) => s + c.correctCount, 0)) /
              cards.reduce((s, c) => s + c.timesShown, 0)
          )
        : 0,
  };

  return {
    cards,
    currentCard,
    loading,
    error,
    stats,
    processAnswer,
    nextCard,
  };
}
