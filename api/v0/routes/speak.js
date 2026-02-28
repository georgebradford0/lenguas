const express = require('express');
const router = express.Router();
const { PollyClient, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');
const { LANGUAGE_CONFIG } = require('../config/languages');

const polly = new PollyClient();

// GET /speak/:text - synthesize speech, returns mp3 audio
// Query param: ?language=de (default) or ?language=nl
router.get('/:text', async (req, res) => {
  try {
    const language = req.query.language || 'de';
    const ttsConfig = (LANGUAGE_CONFIG[language] || LANGUAGE_CONFIG['de']).tts;

    const command = new SynthesizeSpeechCommand({
      Text: req.params.text,
      OutputFormat: 'mp3',
      ...ttsConfig,
    });
    const response = await polly.send(command);
    const bytes = await response.AudioStream.transformToByteArray();
    res.set('Content-Type', 'audio/mpeg');
    res.send(Buffer.from(bytes));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
