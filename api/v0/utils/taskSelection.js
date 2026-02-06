/**
 * Selects appropriate task type based on word tier, mastery level, and last task type
 * @param {number} tier - Word tier (1-4)
 * @param {number} timesShown - Number of times word has been shown
 * @param {number} correctCount - Number of times answered correctly
 * @param {string|null} lastSeenTaskType - Last task type used for this word
 * @returns {string} Task type: 'multipleChoice' or 'reverseTranslation'
 */
function selectTaskType(tier, timesShown, correctCount, lastSeenTaskType) {
  // Calculate mastery level (0-5)
  const accuracy = timesShown > 0 ? correctCount / timesShown : 0;
  let masteryLevel = 0;

  if (timesShown === 0) masteryLevel = 0;        // New
  else if (timesShown <= 3) masteryLevel = 1;    // Learning
  else if (timesShown <= 6) masteryLevel = 2;    // Familiar
  else if (timesShown <= 10) masteryLevel = 3;   // Known
  else if (timesShown <= 15) masteryLevel = 4;   // Mastered
  else masteryLevel = 5;                          // Automatic

  // Adjust mastery based on accuracy
  if (accuracy < 0.5 && masteryLevel > 2) masteryLevel = 2;
  if (accuracy < 0.75 && masteryLevel > 3) masteryLevel = 3;

  // Define task type weights based on tier
  const tierWeights = {
    1: { multipleChoice: 0.80, reverseTranslation: 0.20 },
    2: { multipleChoice: 0.60, reverseTranslation: 0.40 },
    3: { multipleChoice: 0.40, reverseTranslation: 0.60 },
    4: { multipleChoice: 0.30, reverseTranslation: 0.70 },
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

module.exports = { selectTaskType };
