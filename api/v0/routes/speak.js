const express = require('express');
const router = express.Router();
const OpenAI = require('openai');
const { LANGUAGE_CONFIG } = require('../config/languages');

const openai = new OpenAI();

// GET /speak/:text - synthesize speech, returns mp3 audio
// Query param: ?language=de (default) or ?language=nl
router.get('/:text', async (req, res) => {
  try {
    const language = req.query.language || 'de';
    const ttsConfig = (LANGUAGE_CONFIG[language] || LANGUAGE_CONFIG['de']).tts;

    const mp3 = await openai.audio.speech.create({
      model: 'gpt-4o-mini-tts',
      voice: ttsConfig.voice,
      input: req.params.text,
      response_format: 'mp3',
      language: ttsConfig.language,
    });
    const buffer = Buffer.from(await mp3.arrayBuffer());
    res.set('Content-Type', 'audio/mpeg');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
