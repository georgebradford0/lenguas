const express = require('express');
const router = express.Router();
const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
