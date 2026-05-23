// Read-only library API.
//
//   GET /books?language=de   list summaries from s3://bucket/parsed-books/_index.json
//   GET /books/:hash         full SerializedBook from s3://bucket/parsed-books/<hash>.json
//
// Parsing happens offline via bin/parse-epub.js (which is what writes both
// the per-book JSON and the index). The API never mutates the bucket.

const express = require('express');
const router = express.Router();
const bookStore = require('../lib/bookStore');

router.get('/', async (req, res) => {
  const language = typeof req.query.language === 'string' ? req.query.language : null;
  try {
    const all = await bookStore.getIndex();
    const filtered = language ? all.filter(b => b.language === language) : all;
    res.json({ books: filtered });
  } catch (err) {
    console.error('[/books] list failed:', err.message);
    res.status(500).json({ error: 'Failed to list library' });
  }
});

router.get('/:hash', async (req, res) => {
  const { hash } = req.params;
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    return res.status(400).json({ error: 'invalid content hash' });
  }
  try {
    if (!(await bookStore.exists(hash))) {
      return res.status(404).json({ error: 'book not found' });
    }
    const book = await bookStore.get(hash);
    res.json({ book });
  } catch (err) {
    console.error('[/books] get failed:', err.message);
    res.status(500).json({ error: 'Failed to read book' });
  }
});

module.exports = router;
