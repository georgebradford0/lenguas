const express = require('express');
const router = express.Router();
const { PollyClient, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');
const { LANGUAGE_CONFIG } = require('../config/languages');

const polly = new PollyClient();

// Languages Polly has no voice for are synthesized by the tts sidecar (tts/).
const SIDECAR_LANGUAGES = new Set(['la']);
const TTS_URL = process.env.TTS_URL || 'http://tts:8000';

// GET /speak/:text - synthesize speech, returns mp3 audio
// Query param: ?language=de (default), nl, fr, es, or la (sidecar)
router.get('/:text', async (req, res) => {
  try {
    const language = req.query.language || 'de';

    if (SIDECAR_LANGUAGES.has(language)) {
      const upstream = await fetch(`${TTS_URL}/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: req.params.text, language }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!upstream.ok) {
        const detail = await upstream.text().catch(() => '');
        return res.status(upstream.status === 400 || upstream.status === 413 || upstream.status === 422
          ? upstream.status : 502).json({ error: `tts failed: ${upstream.status} ${detail}`.slice(0, 300) });
      }
      res.set('Content-Type', 'audio/mpeg');
      return res.send(Buffer.from(await upstream.arrayBuffer()));
    }

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
