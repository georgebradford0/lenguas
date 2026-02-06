const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// GET /words - return word list with tiers as JSON array of objects
router.get('/', (req, res) => {
  try {
    const csvPath = path.join(__dirname, '..', '..', '..', 'german_words.csv');
    const content = fs.readFileSync(csvPath, 'utf-8');
    const lines = content
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    // Parse CSV: first line is header (word,tier)
    // Return array of objects with word and tier
    const words = lines.slice(1).map((line) => {
      const [word, tier] = line.split(',');
      return { word: word.trim(), tier: parseInt(tier, 10) || 1 };
    });

    res.json(words);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
