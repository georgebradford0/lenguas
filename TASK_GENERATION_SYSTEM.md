# LLM-Based Task Generation System

## Overview

This system replaces the word-by-word vocabulary approach with **dynamic, LLM-generated learning tasks** based on tier curriculum. Tasks can include single words, chunks, phrases, or complete sentences - whatever is most pedagogically appropriate.

## Architecture

### Backend Components

1. **Prompt Generator** (`api/v0/prompts/tier1TaskGenerator.js`)
   - Contains Tier 1 curriculum context from learning plan
   - Generates OpenAI prompts for task creation
   - Supports multiple choice and reverse translation tasks

2. **Task Generation Endpoint** (`api/v0/routes/generateTask.js`)
   - `POST /generate-task` - Creates a new task
   - `POST /submit-answer` - Validates answer and updates progress
   - `GET /tier-progress` - Retrieves user's tier statistics

3. **Progress Model** (`api/v0/models/TierProgress.js`)
   - Tracks tier-level statistics (not individual words)
   - Manages tier unlocking logic
   - Calculates accuracy metrics

## API Endpoints

### 1. Generate Task

**Endpoint:** `POST /generate-task`

**Request Body:**
```json
{
  "tier": 1,
  "taskType": "multipleChoice",
  "focusArea": "general"
}
```

**Response (Multiple Choice):**
```json
{
  "task": {
    "german": "Wo ist das Brot?",
    "correctEnglish": "Where is the bread?",
    "wrongOptions": [
      "Where is the water?",
      "What is the bread?",
      "Who is the bread?"
    ],
    "chunkPattern": "Wo ist...?",
    "focusGrammar": "question words"
  },
  "tier": 1,
  "taskType": "multipleChoice",
  "timestamp": "2026-02-06T12:34:56.789Z"
}
```

**Response (Reverse Translation):**
```json
{
  "task": {
    "english": "I am tired",
    "correctGerman": "Ich bin müde",
    "wrongOptions": [
      "Ich habe müde",
      "Du bist müde",
      "Ich müde bin"
    ],
    "chunkPattern": "Ich bin...",
    "focusGrammar": "sein conjugation"
  },
  "tier": 1,
  "taskType": "reverseTranslation",
  "timestamp": "2026-02-06T12:34:56.789Z"
}
```

### 2. Submit Answer

**Endpoint:** `POST /submit-answer`

**Request Body:**
```json
{
  "userId": "user123",
  "tier": 1,
  "taskType": "multipleChoice",
  "userAnswer": "Where is the bread?",
  "correctAnswer": "Where is the bread?",
  "taskData": { /* original task object */ }
}
```

**Response:**
```json
{
  "correct": true,
  "tier": 1,
  "taskType": "multipleChoice",
  "tierUnlocked": false,
  "currentTier": 1,
  "stats": {
    "accuracy": 0.85,
    "totalAttempts": 23,
    "correctAttempts": 19,
    "overallAccuracy": 0.82
  },
  "timestamp": "2026-02-06T12:35:12.456Z"
}
```

**Tier Unlock Response:**
```json
{
  "correct": true,
  "tier": 1,
  "taskType": "reverseTranslation",
  "tierUnlocked": true,
  "currentTier": 2,
  "stats": {
    "accuracy": 0.77,
    "totalAttempts": 25,
    "correctAttempts": 20,
    "overallAccuracy": 0.80
  },
  "timestamp": "2026-02-06T12:40:30.123Z"
}
```

### 3. Get Tier Progress

**Endpoint:** `GET /tier-progress?userId=user123`

**Response:**
```json
{
  "userId": "user123",
  "currentTier": 1,
  "tierStats": {
    "tier1": {
      "totalAttempts": 23,
      "correctAttempts": 19,
      "multipleChoiceAttempts": 14,
      "multipleChoiceCorrect": 12,
      "reverseTranslationAttempts": 9,
      "reverseTranslationCorrect": 7,
      "unlocked": true,
      "unlockedAt": "2026-02-01T10:00:00.000Z"
    },
    "tier2": {
      "totalAttempts": 0,
      "correctAttempts": 0,
      "multipleChoiceAttempts": 0,
      "multipleChoiceCorrect": 0,
      "reverseTranslationAttempts": 0,
      "reverseTranslationCorrect": 0,
      "unlocked": false,
      "unlockedAt": null
    },
    "tier3": { /* ... */ },
    "tier4": { /* ... */ }
  },
  "overallAccuracy": 0.82,
  "totalTasksCompleted": 23,
  "currentStreak": 0,
  "longestStreak": 0,
  "lastStudyDate": "2026-02-06T12:35:12.456Z"
}
```

## Tier Unlocking Logic

**Criteria:**
- **Minimum attempts:** 20 tasks in current tier
- **Accuracy threshold:** 75% or higher
- **Auto-unlock:** Happens automatically when criteria are met

**Example:**
- User completes 25 tasks in Tier 1 with 80% accuracy
- Next `/submit-answer` request triggers unlock
- Response includes `tierUnlocked: true` and `currentTier: 2`
- Tier 2 is now available for task generation

## Mobile App Integration Example

### Fetch and Display a Task

```typescript
// 1. Fetch user's current tier
const progressResponse = await fetch('http://localhost:3000/tier-progress?userId=user123');
const progress = await progressResponse.json();
const currentTier = progress.currentTier;

// 2. Generate a task for the current tier
const taskResponse = await fetch('http://localhost:3000/generate-task', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    tier: currentTier,
    taskType: 'multipleChoice',
    focusArea: 'general'
  })
});

const { task, tier, taskType } = await taskResponse.json();

// 3. Display the task
// For multiple choice: show task.german with 4 shuffled options
// [task.correctEnglish, ...task.wrongOptions].shuffle()

// 4. User selects an answer
const userAnswer = "Where is the bread?";

// 5. Submit the answer
const submitResponse = await fetch('http://localhost:3000/submit-answer', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userId: 'user123',
    tier,
    taskType,
    userAnswer,
    correctAnswer: task.correctEnglish,
    taskData: task
  })
});

const result = await submitResponse.json();

// 6. Show feedback
if (result.correct) {
  console.log('✓ Correct!');
} else {
  console.log('✗ Wrong');
}

// 7. Check for tier unlock
if (result.tierUnlocked) {
  console.log(`🎉 Congratulations! Tier ${result.currentTier} unlocked!`);
}

// 8. Display updated stats
console.log(`Accuracy: ${(result.stats.accuracy * 100).toFixed(1)}%`);
console.log(`Attempts: ${result.stats.totalAttempts}`);
```

## Benefits of This Approach

### 1. **Pedagogically Sound**
- Tasks can teach chunks and patterns, not just isolated words
- LLM generates contextually appropriate exercises
- Aligns with learning plan's emphasis on implicit learning

### 2. **Flexible Content**
- Can include: "der Hund" (noun with article)
- Can include: "Ich bin müde" (complete sentence)
- Can include: "Wo ist...?" (chunk pattern)
- No rigid word-list constraints

### 3. **Simplified Tracking**
- Progress tracked at tier level, not per-word
- Fewer database records (4 tier stats vs 1000+ words)
- Clear progression: Tier 1 → Tier 2 → Tier 3 → Tier 4

### 4. **Dynamic Difficulty**
- LLM can vary difficulty within a tier
- Wrong options test specific grammar points
- Focus areas can be specified (verbs, articles, questions, etc.)

### 5. **Scalable**
- Easy to add Tier 2, 3, 4 by creating new prompt generators
- Can add new task types (fill-in-blank, listening, etc.)
- LLM handles content generation automatically

## Next Steps

### Immediate (To Get System Working)
1. ✅ Create Tier 1 prompt generator
2. ✅ Create task generation endpoints
3. ✅ Create TierProgress model
4. ✅ Integrate routes into API
5. ⏰ Test endpoints with Postman/curl
6. ⏰ Update mobile app to use new endpoints

### Phase 2 (Tier 2-4)
1. Create `tier2TaskGenerator.js` with Tier 2 curriculum
2. Create `tier3TaskGenerator.js` with Tier 3 curriculum
3. Create `tier4TaskGenerator.js` with Tier 4 curriculum
4. Update `/generate-task` to route to appropriate tier generator

### Phase 3 (Enhanced Features)
1. Add focus areas (verbs, nouns, questions, etc.)
2. Add streak tracking logic
3. Add spaced repetition at tier level
4. Add task history logging
5. Add tier-based task type weighting (from original system)

## Testing

### Test Task Generation
```bash
curl -X POST http://localhost:3000/generate-task \
  -H "Content-Type: application/json" \
  -d '{
    "tier": 1,
    "taskType": "multipleChoice",
    "focusArea": "general"
  }'
```

### Test Answer Submission
```bash
curl -X POST http://localhost:3000/submit-answer \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test-user",
    "tier": 1,
    "taskType": "multipleChoice",
    "userAnswer": "Where is the bread?",
    "correctAnswer": "Where is the bread?",
    "taskData": {}
  }'
```

### Test Progress Retrieval
```bash
curl http://localhost:3000/tier-progress?userId=test-user
```

## Migration Notes

### Old System vs New System

**Old:**
- Load `german_words.csv` (145 words)
- Create Card objects for each word
- Track progress per word (timesShown, correctCount)
- Generate translations via OpenAI for each word
- Spaced repetition weighted by word-level stats

**New:**
- No CSV files needed
- LLM generates tasks on-demand based on tier curriculum
- Track progress per tier (accuracy, attempts)
- Tasks can be words, chunks, sentences, or patterns
- Progression based on tier-level mastery

### What to Keep
- Audio pronunciation (still works with generated German text)
- Task type weighting by tier (can integrate into task selection)
- Multiple choice and reverse translation formats (unchanged)
- UI components (just swap data source)

### What to Remove/Update
- `useCards` hook (replace with tier progress fetching)
- Word-based progress model (replace with TierProgress)
- CSV parsing logic (no longer needed)
- Per-word tracking in database
