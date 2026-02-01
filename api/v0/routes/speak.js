const express = require('express');
const router = express.Router();
const { PollyClient, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');

const polly = new PollyClient();

// GET /speak/:text - synthesize German speech, returns mp3 audio
router.get('/:text', async (req, res) => {
  try {
    const command = new SynthesizeSpeechCommand({
      Text: req.params.text,
      OutputFormat: 'mp3',
      VoiceId: 'Hans',
      LanguageCode: 'de-DE',
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
