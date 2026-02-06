import type { Card } from '../types';

export type TaskType = 'multipleChoice' | 'reverseTranslation';

/**
 * Selects appropriate task type based on word tier, mastery level, and last task type
 */
export function selectTaskType(card: Card): TaskType {
  const { tier, timesShown, correctCount, lastSeenTaskType } = card;

  // Calculate accuracy
  const accuracy = timesShown > 0 ? correctCount / timesShown : 0;

  // Calculate mastery level (0-5)
  let masteryLevel = 0;
  if (timesShown === 0) masteryLevel = 0; // New
  else if (timesShown <= 3) masteryLevel = 1; // Learning
  else if (timesShown <= 6) masteryLevel = 2; // Familiar
  else if (timesShown <= 10) masteryLevel = 3; // Known
  else if (timesShown <= 15) masteryLevel = 4; // Mastered
  else masteryLevel = 5; // Automatic

  // Adjust mastery based on accuracy
  if (accuracy < 0.5 && masteryLevel > 2) masteryLevel = 2;
  if (accuracy < 0.75 && masteryLevel > 3) masteryLevel = 3;

  // Define task type weights based on tier
  const tierWeights: Record<number, { multipleChoice: number; reverseTranslation: number }> = {
    1: { multipleChoice: 0.8, reverseTranslation: 0.2 },
    2: { multipleChoice: 0.6, reverseTranslation: 0.4 },
    3: { multipleChoice: 0.4, reverseTranslation: 0.6 },
    4: { multipleChoice: 0.3, reverseTranslation: 0.7 },
  };

  // Adjust weights based on mastery level
  // Lower mastery = prefer easier tasks (multipleChoice)
  const masteryModifier = masteryLevel <= 1 ? 0.9 : masteryLevel <= 2 ? 0.7 : 1.0;

  let weights = tierWeights[tier] || tierWeights[1];

  // Apply mastery modifier (make multipleChoice more likely for low mastery)
  if (masteryModifier < 1.0) {
    weights = {
      multipleChoice: weights.multipleChoice + (1 - weights.multipleChoice) * (1 - masteryModifier),
      reverseTranslation: weights.reverseTranslation * masteryModifier,
    };
  }

  // Apply variety boost - reduce weight of last used task type
  if (lastSeenTaskType === 'multipleChoice') {
    weights.multipleChoice *= 0.3;
    weights.reverseTranslation *= 1.7;
  } else if (lastSeenTaskType === 'reverseTranslation') {
    weights.reverseTranslation *= 0.3;
    weights.multipleChoice *= 1.7;
  }

  // Normalize weights
  const total = weights.multipleChoice + weights.reverseTranslation;
  weights.multipleChoice /= total;
  weights.reverseTranslation /= total;

  // Weighted random selection
  const rand = Math.random();
  return rand < weights.multipleChoice ? 'multipleChoice' : 'reverseTranslation';
}
