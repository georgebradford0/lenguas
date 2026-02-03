import type { Card } from '../types';

export function getWeight(card: Card): number {
  // Weight = 1 / (1 + timesShown) / (1 + correctCount)
  // Unseen cards: weight = 1. High correct count → very low weight.
  return 1 / (1 + card.timesShown) / (1 + card.correctCount);
}

export function getNextCard(cards: Card[], currentCard: Card | null): Card | null {
  if (cards.length === 0) return null;

  // Exclude the current card so we don't repeat immediately
  const pool = currentCard ? cards.filter((c) => c !== currentCard) : cards;
  if (pool.length === 0) return cards[0];

  const weights = pool.map(getWeight);
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);

  let r = Math.random() * totalWeight;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}
