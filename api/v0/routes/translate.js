const express = require('express');
const router = express.Router();
const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const LANGUAGE_NAMES = { de: 'German', nl: 'Dutch', fr: 'French', es: 'Spanish' };

// POST /translate/sentence
// Translate a full sentence into English and identify every noun and verb in
// the sentence, returning a short English translation and (when grammar is
// non-obvious) an explanation for each. Single round-trip used by the reader.
//
// Body: { sentence: string, language: 'de' | 'nl' | 'fr' | 'es' }
// Response: {
//   translation: string,
//   words: Array<{
//     word: string,        // exactly as it appears in the sentence
//     pos: 'noun' | 'verb',
//     translation: string, // 1-6 word English gloss in this context
//     explanation: string | null,
//   }>
// }
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
  "words": [
    { "word": "<word as it appears in the sentence>", "pos": "noun" | "verb", "translation": "<1-6 word English gloss in this context>", "explanation": "<one short English sentence or null>" }
  ]
}

Rules:
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
      max_tokens: 800,
      response_format: { type: 'json_object' },
    });

    const parsed = JSON.parse(response.choices[0].message.content || '{}');
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

    res.json({
      translation: typeof parsed.translation === 'string' ? parsed.translation : '',
      words,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /translate/chapter - structure raw epub text into clean paragraphs and sentences
router.post('/chapter', async (req, res) => {
  try {
    const { rawLines, language = 'de' } = req.body;
    if (!Array.isArray(rawLines) || rawLines.length === 0) {
      return res.status(400).json({ error: 'rawLines array is required' });
    }

    const fromLanguage = LANGUAGE_NAMES[language] || 'German';
    const CHUNK_CHARS = 6000;

    // Group lines into chunks without splitting mid-line
    const chunks = [];
    let currentChunk = [];
    let currentLen = 0;
    for (const line of rawLines) {
      if (currentLen + line.length > CHUNK_CHARS && currentChunk.length > 0) {
        chunks.push(currentChunk.join('\n'));
        currentChunk = [line];
        currentLen = line.length + 1;
      } else {
        currentChunk.push(line);
        currentLen += line.length + 1;
      }
    }
    if (currentChunk.length > 0) chunks.push(currentChunk.join('\n'));

    const systemPrompt = `You are processing ${fromLanguage} text extracted from an EPUB file. Each line of input is one HTML block element (paragraph, heading, list item, etc.). Some lines may be non-content: page numbers, running headers, chapter labels, navigation text.

Return ONLY valid JSON with this exact shape:
{"paragraphs": [["sentence1", "sentence2"], ["sentence3"]]}

Rules:
- Remove non-content lines (page numbers, "Kapitel X", repeated headers, navigation)
- Merge consecutive lines that form one literary paragraph into a single inner array
- Split each paragraph into individual sentences correctly
- Preserve all original ${fromLanguage} text exactly — do not translate, correct, or rewrite
- Return {"paragraphs": []} if the chunk has no readable content`;

    const results = await Promise.all(
      chunks.map(async (chunk) => {
        const response = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: chunk },
          ],
          temperature: 0,
          max_tokens: 4096,
          response_format: { type: 'json_object' },
        });
        try {
          const parsed = JSON.parse(response.choices[0].message.content || '{}');
          return Array.isArray(parsed.paragraphs)
            ? parsed.paragraphs.filter(p => Array.isArray(p) && p.length > 0)
            : [];
        } catch {
          return [];
        }
      })
    );

    res.json({ paragraphs: results.flat() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
