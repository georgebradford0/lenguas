# Tier Progression System

## Overview
The language learning app uses a tier-based progression system where users must demonstrate mastery of words in one tier before unlocking the next.

## Tier 2 Unlock Conditions

### Word Mastery Criteria
A word is considered **"mastered"** when it meets BOTH of these conditions:
- **7+ attempts** - The word has been shown at least 7 times
- **75%+ accuracy** - At least 75% of attempts on that word were correct

### Tier 2 Unlock Threshold
**Tier 2 unlocks when 75% of Tier 1 words are mastered**

### Current Numbers
- Total Tier 1 words: **102 words**
- Words needed to master: **77 words** (75% of 102)

## Implementation Details

The tier progression logic is implemented in:
- **File**: `/api/v0/routes/generateTask.js`
- **Key logic** (lines 246-257):
  ```javascript
  // Check each Tier 1 word for mastery
  tier1Words.forEach(w => {
    const prog = progressMap[w.word];
    if (prog) {
      const acc = prog.timesShown > 0 ? prog.correctCount / prog.timesShown : 0;
      if (prog.timesShown >= 7 && acc >= 0.75) {
        tier1MasteredCount++;
      }
    }
  });

  // Unlock Tier 2 when threshold is met
  const tier2ShouldBeUnlocked = tier1MasteredCount >= Math.ceil(tier1Words.length * 0.75);
  ```

## User Experience

1. **Automatic Detection**: The system automatically checks for tier unlocks after each answer submission
2. **Celebration**: When a new tier is unlocked, a celebration animation is displayed
3. **Progress Tracking**: Users can view their progress toward tier unlocks in the stats display
4. **Tier Stats Endpoint**: `GET /tier-stats` provides current tier status and mastery percentages

## Mobile App Integration

The mobile app (`mobile/src/hooks/useCards.ts`) handles tier unlocks:
- Detects tier unlock events from the API response
- Displays `TierUnlockCelebration` component when a new tier is reached
- Updates tier stats in real-time after each answer
