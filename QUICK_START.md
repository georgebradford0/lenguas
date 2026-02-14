# Quick Start Guide - New A1/A2/B1 System

## What Changed

Your German learning app now uses the European Framework levels (A1/A2/B1) with simple word translation tasks instead of LLM-generated sentence tasks.

## How to Run

### 1. Migrate Existing Data (One-Time)

If you have existing progress data:

```bash
cd api
node migrate-to-levels.js
```

This will update your progress records from tier 1/2 to A1/A2/B1.

### 2. Start the Backend

```bash
cd api/v0
node index.js
```

Server will start on port 3000 (or your configured PORT).

### 3. Start the Frontend

```bash
cd mobile
npm start
```

## How It Works Now

### Task Types

**Multiple Choice** (easier):
- Shows: German word (e.g., "der Apfel")
- Ask: What is the English translation?
- Options: 4 choices (1 correct, 3 distractors)

**Reverse Translation** (harder):
- Shows: English word (e.g., "apple")
- Ask: What is the German word?
- Options: 4 choices (1 correct, 3 distractors)

### Progression System

**A1 Level** (Beginner):
- Always available
- Mastery: 75% of words with 7+ attempts and 75%+ accuracy
- Task mix: 80% multiple choice, 20% reverse

**A2 Level** (Elementary):
- Unlocks when A1 is 75% mastered
- Task mix: 60% multiple choice, 40% reverse

**B1 Level** (Intermediate):
- Unlocks when A2 is 75% mastered
- Task mix: 40% multiple choice, 60% reverse

### Spaced Repetition

Words you haven't seen or struggled with appear more frequently.
Words you've mastered appear less often.

## Testing the System

### 1. Check Available Words

```bash
# Count words in each level
wc -l wordlists/a1_vocabulary.json
wc -l wordlists/a2_vocabulary.json
wc -l wordlists/b1_vocabulary.json
```

### 2. Test API Endpoints

```bash
# Generate an A1 task
curl -X POST http://localhost:3000/generate-task \
  -H "Content-Type: application/json" \
  -d '{"level": "A1", "taskType": "multipleChoice"}'

# Get level stats
curl http://localhost:3000/level-stats

# Test word translation
curl http://localhost:3000/translate/Apfel
```

### 3. Test Audio

Audio pronunciation still works through the existing `/speak` endpoint:

```bash
curl http://localhost:3000/speak/Guten%20Morgen > output.mp3
```

## Vocabulary Files

Each level has a JSON vocabulary file:

```json
{
  "word": "Apfel",
  "article": "der",
  "pos": "noun",
  "full_entry": "der Apfel, ¨-"
}
```

- `word`: The base German word
- `article`: Article (der/die/das) for nouns
- `pos`: Part of speech (noun, verb, adjective, etc.)
- `full_entry`: Complete entry with plural/conjugation markers

## Customizing Vocabulary

To add more words:

1. Edit the appropriate JSON file:
   - `wordlists/a1_vocabulary.json`
   - `wordlists/a2_vocabulary.json`
   - `wordlists/b1_vocabulary.json`

2. Add entries in the format shown above

3. Restart the backend server

## Troubleshooting

### "No vocabulary found for level A1"
- Check that `wordlists/a1_vocabulary.json` exists
- Verify the file is valid JSON

### Tasks not loading
- Check MongoDB connection
- Verify API server is running on correct port
- Check OPENAI_API_KEY is set in `.env`

### Words not translating
- Ensure OPENAI_API_KEY is valid
- Check API rate limits
- Consider adding a German-English dictionary to avoid LLM calls

### Level not unlocking
- Check mastery criteria: 75% of words need 7+ attempts with 75%+ accuracy
- View `/level-stats` endpoint to see detailed progress

## Future Enhancements

You could add:
- B2, C1, C2 levels
- Static German-English dictionary (eliminate LLM dependency)
- Themed vocabulary sets (food, travel, business, etc.)
- Example sentences for each word
- Verb conjugation practice
- Noun declension practice

## Environment Variables

Make sure your `.env` file has:

```env
MONGO_URI=mongodb://localhost:27017/language-app
OPENAI_API_KEY=your_api_key_here
PORT=3000
```

## Performance Notes

**LLM Usage:**
- Only used for translating words (not generating tasks)
- Uses cheaper `gpt-4o-mini` model
- Each task generation = 4 API calls (1 for target word + 3 for distractors)
- Could be eliminated with a static dictionary

**Speed:**
- Task generation: ~1-2 seconds (with translation)
- Would be <100ms with static dictionary

Enjoy your vocabulary-focused learning! 🎓
