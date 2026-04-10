const express = require('express');
const router = express.Router();
const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const LANGUAGE_NAMES = { de: 'German', nl: 'Dutch', fr: 'French', es: 'Spanish' };

// POST /translate/phrase - translate a word or phrase from any supported language to English
router.post('/phrase', async (req, res) => {
  try {
    const { text, language = 'de' } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'text is required' });
    const fromLanguage = LANGUAGE_NAMES[language] || 'German';
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a ${fromLanguage}-English translator. Translate the given text naturally and accurately. Return only the English translation, no explanation, no quotes.`,
        },
        { role: 'user', content: text.trim() },
      ],
      temperature: 0.1,
      max_tokens: 150,
    });
    res.json({ translation: response.choices[0].message.content?.trim() ?? '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /translate/:word - translate a German word to English with wrong options
router.get('/:word', async (req, res) => {
  try {
    const word = req.params.word;
    const response = await openai.responses.create({
      model: 'gpt-4o-mini',
      input: [
        {
          role: 'system',
          content:
            'You are a German-English dictionary. Given a German word, return a JSON object with "word" (the German word), "translation" (brief English translation, 1-5 words), and "wrong" (an array of exactly 3 plausible but incorrect English translations that could trick a learner).',
        },
        { role: 'user', content: word },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'translation',
          schema: {
            type: 'object',
            properties: {
              word: { type: 'string' },
              translation: { type: 'string' },
              wrong: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 },
            },
            required: ['word', 'translation', 'wrong'],
            additionalProperties: false,
          },
          strict: true,
        },
      },
    });
    res.json(JSON.parse(response.output_text));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
