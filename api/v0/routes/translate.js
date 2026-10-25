const express = require('express');
const router = express.Router();
const OpenAI = require('openai');
const { alignChunks, canonicalizeWords } = require('../lib/verbatim');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  maxRetries: 5,
});

const MODEL = 'gpt-6-luna';

const LANGUAGE_NAMES = { de: 'German', nl: 'Dutch', fr: 'French', es: 'Spanish', la: 'Latin' };

// ── /translate/sentence ────────────────────────────────────────────────────────
// Translate a full sentence into English and tag every word in it: nouns, verbs,
// and adjectives get a contextual translation; every other word (articles,
// prepositions, pronouns, conjunctions, adverbs, particles, numbers) is only
// tagged with its part of speech. Their usage notes are the bulk of the output
// tokens, so they are generated on demand by /translate/word when a word is tapped.
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
    {
      "word": "<word as it appears in the sentence>",
      "pos": "noun" | "verb" | "adjective" | "article" | "preposition" | "pronoun" | "conjunction" | "adverb" | "particle" | "number",
      "translation": "<1-6 word English gloss in this context, or null>",
      "explanation": "<one short English sentence or null>"
    }
  ]
}

Rules for "chunks":
- Partition the entire sentence into clause-level chunks, so the reader sees it in digestible pieces. Each chunk must be grammatically valid on its own: a clause containing its subject, its verb(s), and the objects, complements, and adverbials that belong to that verb (e.g. "Der große Hund läuft schnell durch den Garten" is ONE chunk: subject + verb + adverb + prepositional phrase).
- A verb must NEVER stand alone in a chunk, and a clause must never be split apart. Keep the subject, the whole verb group (auxiliary, modal, participle, infinitive, separable prefix), the objects, and every adverb or prepositional phrase that modifies the verb together in the same chunk.
- DO split a sentence that contains more than one clause. Start a new chunk at EVERY clause boundary: between a main clause and a subordinate or relative clause; between coordinated or contrasted clauses (und, aber, denn, et, mais, y, pero, ...), including a second half that has no verb of its own because it elides it (e.g. "..., mais la nature comme processus de production"); after a fronted subject clause or free relative (e.g. "Ce que le schizophrène vit spécifiquement, génériquement," is its own chunk, then "ce n'est pas du tout un pôle spécifique de la nature," is the next); and around a standalone vocative, address, heading, or other fragment that has no verb. A comma or semicolon that separates clauses is a strong signal for a boundary.
- An infinitive or participial phrase gets its own chunk only if it has its own objects or complements; otherwise keep it with the clause it depends on. If a clause is interrupted by an embedded clause (e.g. a relative clause in the middle of the main clause), keep the whole thing together as one chunk.
- Only a sentence that truly has a single clause is ONE chunk, however long it is. Do not leave a multi-clause sentence whole.
- Each "original" must be a VERBATIM contiguous span of the source sentence. Concatenating every chunk's "original" in order, with single spaces between them, must reproduce the sentence (modulo whitespace).
- Copy each "original" character-for-character from the sentence. NEVER correct, modernize, normalize, or substitute any word — keep archaic or unusual spellings exactly as written (e.g. if the sentence says "innigst", write "innigst", not "inniglich"). Do not add, drop, merge, or reorder words.
- Do NOT split inside a single word, and keep adjacent punctuation attached to its chunk.
- Each "translation" is a literal-but-readable English rendering of that span on its own — not a full reflowed translation of the whole sentence.

Rules for "words":
- "words" contains EVERY word in the sentence — every noun, verb, adjective, article, preposition, pronoun, conjunction, adverb, particle, and number. Exclude only punctuation.
- "word" must match exactly how the word appears in the sentence — preserve case and inflection, and copy it from the sentence without correcting or modernizing its spelling. Do NOT lemmatize.
- Include each surface occurrence at most once, in the order they appear.
- For "pos" of noun, verb, or adjective (including auxiliary, modal, participle, and infinitive verb forms, and predicate/attributive adjectives):
  * Fill "translation" with a 1-6 word English gloss in this context.
  * Fill "explanation" with a short English sentence only when the word's meaning here is non-obvious or context-dependent (e.g. separable-prefix verb, idiomatic noun usage). Otherwise null.
- For every other "pos" (article, preposition, pronoun, conjunction, adverb, particle, number):
  * Leave "translation" and "explanation" null. Write nothing else about these words; only "word" and "pos" matter.`;

    const sourceSentence = sentence.trim();

    const RETRY_NOTE = `IMPORTANT: your previous answer did not reproduce the sentence word-for-word. Copy every chunk's "original" character-for-character from the sentence. Do not correct spelling, modernize archaic forms, change punctuation, or add, drop, merge, or reorder any word. Taken together, the chunks must contain exactly the words of the sentence, in order.`;

    const ask = async (note) => {
      const response = await openai.chat.completions.create({
        model: MODEL,
        messages: [
          { role: 'system', content: note ? `${systemPrompt}\n\n${note}` : systemPrompt },
          { role: 'user', content: sourceSentence },
        ],
        reasoning_effort: 'low',
        max_completion_tokens: 16384,
        response_format: { type: 'json_object' },
      });
      const parsed = JSON.parse(response.choices[0].message.content || '{}');
      const modelChunks = Array.isArray(parsed.chunks)
        ? parsed.chunks
            .filter(c => c && typeof c.original === 'string' && c.original.trim() && typeof c.translation === 'string')
            .map(c => ({ original: c.original, translation: c.translation.trim() }))
        : [];
      return { parsed, aligned: alignChunks(sourceSentence, modelChunks) };
    };

    // Whatever the model returns, the source text we send back is sliced from the
    // sentence itself (see lib/verbatim.js). If its chunks can't be mapped onto the
    // sentence we retry once, then fall back to one whole-sentence chunk — less
    // granular, but never wrong.
    let { parsed, aligned } = await ask();
    if (!aligned) {
      console.warn('[translate/sentence] chunks did not reproduce the sentence; retrying once');
      ({ parsed, aligned } = await ask(RETRY_NOTE));
    }

    const translation = typeof parsed.translation === 'string' ? parsed.translation : '';
    let chunks;
    if (aligned) {
      chunks = aligned.chunks;
      if (aligned.repaired > 0) {
        console.warn(`[translate/sentence] repaired ${aligned.repaired} reworded token(s) in chunks`);
      }
    } else {
      console.warn('[translate/sentence] chunks still did not reproduce the sentence; returning one whole-sentence chunk');
      chunks = [{ original: sourceSentence, translation }];
    }

    const VALID_POS = new Set([
      'noun', 'verb', 'adjective',
      'article', 'preposition', 'pronoun', 'conjunction', 'adverb', 'particle', 'number',
    ]);
    const modelWords = Array.isArray(parsed.words)
      ? parsed.words
          .filter(w => w && typeof w.word === 'string' && VALID_POS.has(w.pos))
          .map(w => ({
            word: w.word,
            pos: w.pos,
            translation: typeof w.translation === 'string' && w.translation.trim() ? w.translation : null,
            explanation: typeof w.explanation === 'string' && w.explanation.trim() ? w.explanation : null,
            // Filled on demand by /translate/word; kept in the shape for clients.
            usageInSentence: null,
            usageInGeneral: null,
          }))
      : [];
    const { words, repairs, droppedWords } = canonicalizeWords(sourceSentence, modelWords);
    if (repairs.length > 0 || droppedWords.length > 0) {
      console.warn(`[translate/sentence] words: repaired ${JSON.stringify(repairs)}, dropped ${JSON.stringify(droppedWords)}`);
    }

    res.json({ translation, chunks, words });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── /translate/word ───────────────────────────────────────────────────────────
// Usage notes for one tapped non-content word (article, preposition, pronoun,
// ...), generated on demand so /translate/sentence doesn't pay for every one.
router.post('/word', async (req, res) => {
  try {
    const { word, sentence, language = 'de', pos } = req.body;
    if (typeof word !== 'string' || !word.trim()) {
      return res.status(400).json({ error: 'word is required' });
    }
    if (typeof sentence !== 'string' || !sentence.trim()) {
      return res.status(400).json({ error: 'sentence is required' });
    }
    const fromLanguage = LANGUAGE_NAMES[language] || 'German';
    const posNote = typeof pos === 'string' && pos.trim() ? ` (${pos.trim().slice(0, 20)})` : '';

    const systemPrompt = `You are a ${fromLanguage}-English language expert helping a learner who tapped a word in a ${fromLanguage} sentence. Return ONLY valid JSON with this exact shape:

{
  "usageInSentence": "<one short English sentence>",
  "usageInGeneral": "<one short English sentence>"
}

- "usageInSentence": why this specific word/form appears here — case, agreement, word order, idiomatic pairing, what it refers back to, etc.
- "usageInGeneral": what this word means and how it's generally used in ${fromLanguage}, independent of this sentence.`;

    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Sentence: ${sentence.trim().slice(0, 2000)}\nWord${posNote}: ${word.trim().slice(0, 100)}` },
      ],
      reasoning_effort: 'low',
      max_completion_tokens: 1000,
      response_format: { type: 'json_object' },
    });
    const parsed = JSON.parse(response.choices[0].message.content || '{}');
    const text = v => (typeof v === 'string' && v.trim() ? v.trim() : null);
    res.json({ usageInSentence: text(parsed.usageInSentence), usageInGeneral: text(parsed.usageInGeneral) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── /translate/ask ────────────────────────────────────────────────────────────
// Answer a follow-up question about a specific sentence the reader currently
// has open. Stateless like every other route: the client resends the sentence
// (as context) and the prior chat turns on every call.
router.post('/ask', async (req, res) => {
  try {
    const { sentence, translation, language = 'de', question, history = [] } = req.body;
    if (!sentence || !sentence.trim()) {
      return res.status(400).json({ error: 'sentence is required' });
    }
    if (!question || !question.trim()) {
      return res.status(400).json({ error: 'question is required' });
    }
    const fromLanguage = LANGUAGE_NAMES[language] || 'German';

    const contextLine = typeof translation === 'string' && translation.trim()
      ? `The learner is looking at this ${fromLanguage} sentence: "${sentence.trim()}" (English: "${translation.trim()}").`
      : `The learner is looking at this ${fromLanguage} sentence: "${sentence.trim()}".`;

    const systemPrompt = `You are a brief, friendly ${fromLanguage}-English language tutor embedded in a reading app. ${contextLine}

Answer the learner's question about this sentence — grammar, vocabulary, word choice, nuance, cultural context, etc. Always respond in English, even if the question is asked in ${fromLanguage} — you may quote ${fromLanguage} words/phrases inline, but the explanation itself must be in English. Keep answers to 1-3 short sentences. Be direct; skip preamble like "Great question!". If the question isn't about this sentence or language learning, briefly say you can only help with the current sentence.`;

    const historyMessages = Array.isArray(history)
      ? history
          .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
          .slice(-12)
          .map(m => ({ role: m.role, content: m.content.trim() }))
      : [];

    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        ...historyMessages,
        { role: 'user', content: question.trim() },
      ],
      reasoning_effort: 'low',
      max_completion_tokens: 2000,
    });

    const answer = response.choices[0]?.message?.content?.trim() || '';
    res.json({ answer });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
