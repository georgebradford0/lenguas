import type { Card } from '../types';

export interface Stats {
  total: number;
  unseen: number;
  reviewed: number;
  accuracy: number;
}

export function calculateStats(cards: Card[], reviewedCount: number): Stats {
  const total = cards.length;
  const unseen = cards.filter((c) => c.timesShown === 0).length;
  const totalShown = cards.reduce((s, c) => s + c.timesShown, 0);
  const totalCorrect = cards.reduce((s, c) => s + c.correctCount, 0);
  const accuracy = totalShown > 0 ? Math.round((100 * totalCorrect) / totalShown) : 0;

  return {
    total,
    unseen,
    reviewed: reviewedCount,
    accuracy,
  };
}
