# Word Injection System

## Overview

Hybrid approach combining:
- **Word selection from CSV** (spaced repetition, mastery tracking)
- **LLM task generation** (varied contexts, different sentences each time)

## How It Works

### 1. Word Selection (Backend)
```javascript
// Load words from tier CSV
const words = loadWordsForTier(1); // tier1.csv or tier2.csv

// Select word using weighted spaced repetition
const targetWord = selectWord(words, progressRecords);
// Prioritizes: unseen words > struggling words > mastered words
```

### 2. Word Injection (Prompt)
```javascript
// Inject word into LLM prompt
const prompt = generateTier1TaskPrompt('multipleChoice', {
  targetWord: 'der Hund'
});
// LLM MUST use "der Hund" in the German text
```

### 3. Task Generation (LLM)
LLM creates varied tasks around the same word:
- **Task 1:** "der Hund" → "the dog"
- **Task 2:** "Wo ist der Hund?" → "Where is the dog?"
- **Task 3:** "Der Hund ist groß" → "The dog is big"

Same word, different contexts = variety + mastery

### 4. Progress Tracking (Per-Word)
```javascript
// Track each word individually
{
  word: "der Hund",
  tier: 1,
  timesShown: 5,
  correctCount: 4,
  lastSeenTaskType: "multipleChoice"
}
```

## API Endpoints

### Generate Task
```bash
POST /generate-task
{
  "tier": 1,
  "taskType": "multipleChoice"
}

Response:
{
  "task": { "german": "der Hund", ... },
  "targetWord": "der Hund",  # <-- Word being tested
  "tier": 1,
  "taskType": "multipleChoice"
}
```

### Submit Answer
```bash
POST /submit-answer
{
  "targetWord": "der Hund",  # <-- Track this word
  "userAnswer": "the dog",
  "correctAnswer": "the dog",
  "tier": 1,
  "taskType": "multipleChoice"
}

Response:
{
  "correct": true,
  "word": "der Hund",
  "stats": {
    "timesShown": 6,
    "correctCount": 5,
    "accuracy": 83
  }
}
```

### Get Tier Stats
```bash
GET /tier-stats

Response:
{
  "currentTier": 1,
  "tierStats": [
    {
      "tier": 1,
      "total": 103,
      "mastered": 12,
      "percentage": 12,
      "accuracy": 78
    }
  ],
  "overallAccuracy": 78,
  "totalWords": 303
}
```

## CSV Structure

### tier1.csv (103 words)
- Nouns with articles: der Hund, die Katze, das Haus
- Verbs in infinitive: sein, haben, gehen, machen

### tier2.csv (200 words)
- More nouns: das Fleisch, der Fisch, die Küche
- More verbs: kochen, backen, kaufen, fahren

**Only nouns and verbs** - no function words, pronouns, or particles

## Benefits

✅ **Variety:** LLM creates different sentences for the same word
✅ **Spaced Repetition:** Words selected by mastery level
✅ **Per-Word Tracking:** Know exactly which words need work
✅ **Context Learning:** See words in varied sentence structures
✅ **No Repetition:** Same word, but different tasks each time

## Testing

```bash
# Test word injection
cd api/v0
node test-word-injection.js

# Should show:
# - "der Hund" injected into task
# - Different task contexts
# - Word found in generated German text
```

## Files Changed

**Backend:**
- `api/v0/routes/generateTask.js` - Word selection & injection
- `api/v0/prompts/tier1TaskGenerator.js` - Accept targetWord param
- `tier1.csv` - 103 nouns & verbs
- `tier2.csv` - 200 nouns & verbs

**Mobile:**
- `src/types/index.ts` - Updated types (targetWord, stats)
- `src/api/client.ts` - Updated API calls
- `src/hooks/useCards.ts` - Per-word tracking
- `src/screens/QuizScreen.tsx` - Removed tier unlock

**Database:**
- Uses existing `Progress` model (per-word tracking)
- No changes to schema needed
