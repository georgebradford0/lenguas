# Translation Caching

## Token cost overview (4 hours of use)

There are two distinct usage modes, each with its own call pattern and cost profile.

### Flashcard mode (`/generate-task`)

Every task generation makes 4 gpt-4o-mini calls — one for the correct answer and three for distractors. No caching; the same word is retranslated every time it appears.

At 1 card/minute × 4 hours = 240 tasks:

| | Per task | 240 tasks |
|--|---------|-----------|
| Input tokens | ~152 | ~36,500 |
| Output tokens | ~12 | ~2,900 |
| OpenAI cost | — | ~$0.008 |

### Epub reader — sentence mode (`/translate/phrase`, `/translate/word`)

Sentence mode fires **automatically on every sentence advance**:

- `POST /translate/phrase` — translates the full sentence to English  
  - System prompt ~25 tokens + sentence ~18 tokens in; ~18 tokens out (max_tokens=150)  
  - **~61 tokens per sentence**

On demand when the user taps a word:

- `POST /translate/word` — translates the word in context, optionally adds a grammar explanation  
  - System prompt ~65 tokens + `Word + Sentence` ~23 tokens in; JSON response ~50 tokens out (max_tokens=200)  
  - **~138 tokens per word tap**

TTS (`/speak`) is served via **AWS Polly**, not OpenAI — ~$4/1M characters, negligible at this scale.

At 25 seconds/sentence × 4 hours = ~580 sentences, with an average of 3 word taps per sentence:

| | Per sentence | 580 sentences |
|--|-------------|--------------|
| `translatePhrase` tokens | ~61 | ~35,400 |
| `translateWord` tokens (×3) | ~414 | ~240,000 |
| **Total tokens** | **~475** | **~275,000** |
| OpenAI cost | — | ~**$0.07** |

The word-level translation prompt is the main cost driver: at 3 taps per sentence it accounts for ~87% of tokens.

### Combined 4-hour session

If a user splits time roughly evenly (2 hours flashcard + 2 hours reading):

| Mode | Tasks/sentences | Tokens | Cost |
|------|----------------|--------|------|
| Flashcard (2 hr) | 120 tasks | ~23,000 | ~$0.004 |
| Epub reader (2 hr) | 290 sentences | ~138,000 | ~$0.035 |
| **Total** | — | **~161,000** | **~$0.039** |

---

## Problem (flashcard mode)

Every call to `/generate-task` makes 4 gpt-4o-mini requests to OpenAI — one for the target word and three for its distractors. There is no caching, so the same word is retranslated every time it appears via spaced repetition.

At a typical learning pace (1 card/minute, 4 hours/day), a single user generates ~240 tasks and ~46,000 tokens daily. Since A1 has only 641 words and the spaced repetition algorithm surfaces the same words repeatedly, a large fraction of those calls are duplicates.

## Proposed Solution

Store the English translation alongside the word's progress record in MongoDB. On task generation, check for a cached translation before calling OpenAI.

### Schema change — `Progress.js`

Add a `translation` field to the existing schema:

```js
translation: { type: String, default: null },
```

### Logic change — `generateTask.js`

In the `/generate-task` route, before calling `translateWord`, look up the cached value:

```js
// Translate target word (use cached translation if available)
let correctEnglish;
const progressRecord = await Progress.findOne({ userId, word: targetWord.word, language });
if (progressRecord?.translation) {
  correctEnglish = progressRecord.translation;
} else {
  const result = await translateWord(targetFormatted.audio, { language });
  correctEnglish = result.translation;
  // Persist for future tasks
  await Progress.updateOne(
    { userId, word: targetWord.word, language },
    { $set: { translation: correctEnglish } },
    { upsert: true }
  );
}
```

Distractor translations can be cached the same way, since distractors are also vocabulary words with their own progress records.

## Expected Impact

| Scenario | Without cache | With cache (after warm-up) |
|----------|--------------|---------------------------|
| Tokens per task | ~170 | ~40 (distractors only, until cached) |
| Tokens per 240-task session | ~46,000 | ~5,000–10,000 |
| OpenAI cost per user/day | ~$0.008 | ~$0.001 |
| Reduction | — | ~80% |

The cache warms up quickly. A1 has 641 words; after a few sessions the vast majority of words a user encounters will already have a stored translation.

## Distractor caching note

Distractors are selected randomly from the vocabulary pool on each request. If all distractor words already have cached translations, the `translateWords()` call can be skipped entirely and replaced with Progress lookups. This requires fetching progress records for all candidates before selection, which is already done for the spaced repetition weights — so the data is available at no extra cost.

## Alternative: in-memory cache

A `Map<string, string>` keyed on `${language}:${word}` would eliminate the OpenAI call within a single server process lifetime. This is simpler to implement but resets on every container restart and is not shared across multiple API instances. The MongoDB approach is preferred because it persists across restarts and works in a multi-container setup.

## Epub reader caching opportunities

### Sentence translations

`translatePhrase` is called on every sentence advance with no caching. Sentences from the same book will repeat across sessions (re-reading, re-opening the same chapter). A MongoDB collection keyed on `hash(language + sentence_text)` would serve cache hits on the second read.

This is lower priority than flashcard caching because sentence text is more varied than vocabulary words, so the hit rate will be lower.

### Word translations in sentence mode

`SentenceModePanel` calls `translateWord` directly with no caching. The `useTranslation` hook has a `cacheRef` (in-memory, session-scoped) but it is wired to the separate `GET /translate/:word` endpoint used in the simpler reading mode — not to `POST /translate/word`.

The simplest fix is to add the same `cacheRef` pattern inside `SentenceModePanel`, keyed on `${language}:${word}:${sentenceId}`. Because the context (sentence) affects the translation and grammar explanation, using the word alone as the key would sometimes return a stale or wrong-context explanation. Keying on `(word, sentenceId)` is safe.

For a higher hit rate, cache on word alone and accept occasional context drift — most single-word translations are stable regardless of sentence.

---

## Rollout

1. Add `translation` field to `Progress.js` (backwards-compatible, defaults to `null`).
2. Update `/generate-task` route to read and write the cached translation.
3. Deploy with `./deploy.sh`. No database migration needed; the cache fills passively.
4. Optionally, run a one-off backfill script against all unique words in the Progress collection to pre-warm the cache.
5. (Lower priority) Add `cacheRef` for word taps in `SentenceModePanel.tsx` to eliminate repeated lookups within a session.
