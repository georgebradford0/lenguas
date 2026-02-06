import { useState, useCallback, useEffect } from 'react';
import type { Card } from '../types';
import { loadWords, loadProgress, saveProgress } from '../api/client';
import { getNextCard } from '../utils/weightedSelection';
import { selectTaskType } from '../utils/taskSelection';

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
        const initialCards = words.map((wordData) => {
          const saved = progress[wordData.word];
          const card: Card = {
            word: wordData.word,
            tier: wordData.tier,
            timesShown: saved?.timesShown || 0,
            correctCount: saved?.correctCount || 0,
            lastSeenTaskType: saved?.lastSeenTaskType || null,
          };
          return card;
        });
        setCards(initialCards);
        const firstCard = getNextCard(initialCards, null);
        if (firstCard) {
          firstCard.taskType = selectTaskType(firstCard);
        }
        setCurrentCard(firstCard);
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

      const updatedCard: Card = {
        ...currentCard,
        timesShown: currentCard.timesShown + 1,
        correctCount: currentCard.correctCount + (correct ? 1 : 0),
        lastSeenTaskType: currentCard.taskType || null,
      };

      setCards((prev) => prev.map((c) => (c.word === currentCard.word ? updatedCard : c)));
      setReviewedCount((prev) => prev + 1);

      // Save progress to API
      saveProgress(currentCard.word, {
        timesShown: updatedCard.timesShown,
        correctCount: updatedCard.correctCount,
        tier: updatedCard.tier,
        lastSeenTaskType: updatedCard.lastSeenTaskType || undefined,
      }).catch(console.error);

      return updatedCard;
    },
    [currentCard]
  );

  const nextCard = useCallback(() => {
    setCurrentCard((prev) => {
      const next = getNextCard(cards, prev);
      if (next) {
        next.taskType = selectTaskType(next);
      }
      return next;
    });
  }, [cards]);

  // Calculate tier-specific stats
  const tierStats = [1, 2, 3, 4].map((tier) => {
    const tierCards = cards.filter((c) => c.tier === tier);
    const totalInTier = tierCards.length;
    const masteredInTier = tierCards.filter((c) => {
      const accuracy = c.timesShown > 0 ? c.correctCount / c.timesShown : 0;
      return c.timesShown >= 7 && accuracy >= 0.75; // Known level (mastery 3+)
    }).length;

    return {
      tier,
      total: totalInTier,
      mastered: masteredInTier,
      percentage: totalInTier > 0 ? Math.round((masteredInTier / totalInTier) * 100) : 0,
    };
  }).filter((t) => t.total > 0); // Only include tiers with words

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
    tierStats,
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
