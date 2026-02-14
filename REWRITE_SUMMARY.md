# Language Learning App Rewrite Summary

## Overview
The app has been rewritten to use the European Framework A1/A2/B1 levels with simple word translation tasks instead of LLM-generated sentence-based tasks.

## Major Changes

### 1. Backend Changes (`api/v0/routes/generateTask.js`)

**Before:**
- Used OpenAI LLM to generate complex sentence-based tasks
- Had Tier 1/2 system with CSV word lists
- Generated contextual sentences with grammar focus

**After:**
- Loads vocabulary from JSON files (A1/A2/B1)
- Generates simple word translation tasks
- Still uses LLM but only for:
  - Translating German words to English
  - No complex sentence generation
- Implements spaced repetition through weighted word selection
- Generates intelligent distractors based on part of speech

**New Endpoints:**
- `POST /generate-task` - Now accepts `level` (A1/A2/B1) instead of `tier`
- `POST /submit-answer` - Tracks progress by `level` instead of `tier`
- `GET /level-stats` - Returns statistics for A1/A2/B1 levels
- `GET /tier-stats` - Legacy endpoint for backward compatibility

### 2. Data Model Changes

**Progress Model** (`api/v0/models/Progress.js`):
```javascript
{
  word: String,
  tier: Number,      // Legacy field (kept for backward compatibility)
  level: String,     // New field: 'A1', 'A2', 'B1'
  timesShown: Number,
  correctCount: Number,
  lastSeenTaskType: String
}
```

### 3. Vocabulary System

**Word Lists:**
- `wordlists/a1_vocabulary.json` - A1 level vocabulary
- `wordlists/a2_vocabulary.json` - A2 level vocabulary
- `wordlists/b1_vocabulary.json` - B1 level vocabulary

**Vocabulary Entry Structure:**
```json
{
  "word": "Apfel",
  "article": "der",
  "pos": "noun",
  "full_entry": "der Apfel, ¨-"
}
```

### 4. Frontend Changes

**Types** (`mobile/src/types/index.ts`):
- Added `Level` type: 'A1' | 'A2' | 'B1'
- Added `LevelStats` interface for level-based statistics
- Added `VocabWord` interface for vocabulary entries
- Updated `GenerateTaskResponse` to use `level` instead of `tier`
- Kept legacy tier types for backward compatibility

**API Client** (`mobile/src/api/client.ts`):
- Updated `generateTask()` to accept `level` (A1/A2/B1) instead of `tier`
- Added `getLevelStats()` function
- Kept `getTierStats()` for backward compatibility

**useCards Hook** (`mobile/src/hooks/useCards.ts`):
- Changed to use levels (A1/A2/B1) instead of tiers (1/2/3)
- Returns both level-based and tier-based props for compatibility
- Task type weights adjusted for each level:
  - A1: 80% multiple choice, 20% reverse translation
  - A2: 60% multiple choice, 40% reverse translation
  - B1: 40% multiple choice, 60% reverse translation

**StatsBar Component** (`mobile/src/components/StatsBar.tsx`):
- Updated to support both level-based (A1/A2/B1) and tier-based (1/2/3) display
- Uses level colors for A1/A2/B1
- Backward compatible with tier system

**QuizScreen** (`mobile/src/screens/QuizScreen.tsx`):
- Updated to use new level stats
- Passes both level and tier props to components for compatibility

### 5. Mastery Progression

**Unchanged Criteria:**
- A word is "mastered" when: `timesShown >= 7` AND `accuracy >= 75%`
- 7+ attempts with 75%+ accuracy

**New Level Progression:**
- **A1** → Always available (starter level)
- **A2** → Unlocks when 75% of A1 words are mastered
- **B1** → Unlocks when 75% of A2 words are mastered

**Replaced:**
- Tier 1 → A1
- Tier 2 → A2
- (No Tier 3/4) → B1 (future: can add B2/C1/C2)

### 6. Task Generation Flow

**New Simplified Flow:**

1. **Load vocabulary** for current level (A1/A2/B1)
2. **Select target word** using weighted spaced repetition
3. **Generate distractors** (3 wrong options)
   - Prioritize same part of speech for plausibility
   - Mix in different parts of speech
4. **Translate to English** using OpenAI mini model
5. **Build task:**
   - Multiple Choice: Show German → Select English
   - Reverse Translation: Show English → Select German
6. **Include audio** (existing `/speak` endpoint still works)

### 7. Benefits of New System

**Advantages:**
- ✅ **Faster task generation** - No complex LLM prompts
- ✅ **Lower costs** - Only translating words, not generating sentences
- ✅ **More predictable** - Vocabulary-based instead of creative
- ✅ **Clearer progression** - Standard A1/A2/B1 framework
- ✅ **Easier to expand** - Just add more vocabulary JSON files
- ✅ **Better for flashcard-style learning** - Focus on individual words
- ✅ **Still includes audio** - Pronunciation practice maintained

**Trade-offs:**
- ❌ Less contextual - No longer using words in sentences
- ❌ Less grammar focus - Primarily vocabulary building
- ❌ Still uses LLM for translation - Could be eliminated with a static dictionary

### 8. Backward Compatibility

The system maintains backward compatibility:
- Legacy `tier` endpoints still work
- Progress data includes both `tier` and `level` fields
- Frontend components accept both tier and level props
- Old tier-based stats map to new levels:
  - Tier 1 → A1
  - Tier 2 → A2
  - Tier 3 → B1

### 9. What Still Uses LLM

**Minimal LLM Usage:**
- Word translation (German → English)
- Simple 1-word/phrase translations using `gpt-4o-mini`
- Could be replaced with a static German-English dictionary

**No Longer Uses LLM:**
- ❌ Sentence generation
- ❌ Grammar focus selection
- ❌ Pronoun variety tracking
- ❌ Context-based tasks

### 10. Testing Checklist

To test the new system:

1. **Backend:**
   ```bash
   cd api/v0
   node index.js
   ```
   - Test `POST /generate-task` with `level: "A1"`
   - Test `POST /submit-answer` with progress tracking
   - Test `GET /level-stats` to verify A1/A2/B1 progression

2. **Frontend:**
   ```bash
   cd mobile
   npm start
   ```
   - Verify tasks load with German words
   - Check audio pronunciation works
   - Confirm mastery tracking shows correct percentages
   - Test level unlock (A1 → A2)

3. **Data Migration:**
   - Existing progress records will need `level` field populated
   - Can run a migration script to set `level` based on `tier`:
     - `tier: 1` → `level: 'A1'`
     - `tier: 2` → `level: 'A2'`

### 11. Future Improvements

**Could be added:**
- Add B2, C1, C2 levels
- Replace LLM translation with static dictionary
- Add example sentences (separate from main tasks)
- Add conjugation/declension practice
- Include plural forms and verb conjugations
- Add themed vocabulary sets (food, travel, etc.)

## Files Modified

### Backend
- `api/v0/routes/generateTask.js` - Complete rewrite
- `api/v0/models/Progress.js` - Added `level` field

### Frontend
- `mobile/src/types/index.ts` - Added level types
- `mobile/src/api/client.ts` - Updated API functions
- `mobile/src/hooks/useCards.ts` - Changed to level-based system
- `mobile/src/components/StatsBar.tsx` - Support for levels
- `mobile/src/screens/QuizScreen.tsx` - Updated to pass level props

### Data
- Uses existing vocabulary JSON files:
  - `wordlists/a1_vocabulary.json`
  - `wordlists/a2_vocabulary.json`
  - `wordlists/b1_vocabulary.json`

## Summary

The rewrite successfully transforms the app from an LLM-driven sentence-based learning system to a vocabulary-focused A1/A2/B1 framework that:
- Uses simple word translation tasks
- Maintains spaced repetition and mastery tracking
- Keeps audio pronunciation
- Reduces LLM dependency (only for translations)
- Aligns with European language proficiency standards
- Is easier to maintain and extend
