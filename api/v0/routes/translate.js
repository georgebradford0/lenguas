const express = require('express');
const router = express.Router();
const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 5 });

const LANGUAGE_NAMES = { de: 'German', nl: 'Dutch', fr: 'French', es: 'Spanish' };

// ── /translate/sentence ────────────────────────────────────────────────────────
// Translate a full sentence into English and identify every noun and verb in
// the sentence, returning a short English translation and (when grammar is
// non-obvious) an explanation for each.
router.post('/sentence', async (req, res) => {
  try {
    const { sentence, language = 'de' } = req.body;
    if (!sentence || !sentence.trim()) {
      return res.status(400).json({ error: 'sentence is required' });
    }
    const fromLanguage = LANGUAGE_NAMES[language] || 'German';

    const systemPrompt = `You are a ${fromLanguage}-English language expert. Given one ${fromLanguage} sentence, return ONLY valid JSON with this exact shape:

{
  "translation": "<natural English translation of the whole sentence>",
  "chunks": [
    { "original": "<verbatim span of the source sentence>", "translation": "<literal-but-readable English rendering of that span>" }
  ],
  "words": [
    { "word": "<word as it appears in the sentence>", "pos": "noun" | "verb", "translation": "<1-6 word English gloss in this context>", "explanation": "<one short English sentence or null>" }
  ]
}

Rules for "chunks":
- Partition the entire sentence into grammatically coherent chunks: clauses, prepositional phrases, noun phrases with their modifiers, verb groups, etc. Each chunk should be a unit that makes sense to translate together.
- Each "original" must be a VERBATIM contiguous span of the source sentence. Concatenating every chunk's "original" in order, with single spaces between them, must reproduce the sentence (modulo whitespace).
- Do NOT split inside a single word, and keep adjacent punctuation attached to its chunk.
- Each "translation" is a literal-but-readable English rendering of that span on its own — not a full reflowed translation of the whole sentence.
- Aim for 2-6 chunks per typical sentence. Very short sentences may be a single chunk.

Rules for "words":
- "words" contains every noun and every verb in the sentence (including auxiliary, modal, participle, and infinitive verb forms). Exclude articles, prepositions, pronouns, conjunctions, adjectives, adverbs, particles, and numbers.
- "word" must match exactly how the word appears in the sentence — preserve case and inflection. Do NOT lemmatize.
- Include each surface occurrence at most once, in the order they appear.
- "explanation" is a short English sentence only when the word's meaning here is non-obvious or context-dependent (e.g. separable-prefix verb, idiomatic noun usage). Otherwise null.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: sentence.trim() },
      ],
      temperature: 0.1,
      max_tokens: 8096,
      response_format: { type: 'json_object' },
    });

    const parsed = JSON.parse(response.choices[0].message.content || '{}');
    const translation = typeof parsed.translation === 'string' ? parsed.translation : '';
    const chunks = Array.isArray(parsed.chunks)
      ? parsed.chunks
          .filter(c => c && typeof c.original === 'string' && c.original.trim() && typeof c.translation === 'string')
          .map(c => ({ original: c.original.trim(), translation: c.translation.trim() }))
      : [];
    // Fallback: if the model returns no chunks, treat the whole sentence as one chunk.
    if (chunks.length === 0) {
      chunks.push({ original: sentence.trim(), translation });
    }
    const words = Array.isArray(parsed.words)
      ? parsed.words
          .filter(w => w && typeof w.word === 'string' && (w.pos === 'noun' || w.pos === 'verb'))
          .map(w => ({
            word: w.word,
            pos: w.pos,
            translation: typeof w.translation === 'string' ? w.translation : '',
            explanation: typeof w.explanation === 'string' && w.explanation.trim() ? w.explanation : null,
          }))
      : [];

    res.json({ translation, chunks, words });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
