const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// GET /words - return word list as JSON array
router.get('/', (req, res) => {
  try {
    const csvPath = path.join(__dirname, '..', '..', '..', 'german_words.csv');
    const content = fs.readFileSync(csvPath, 'utf-8');
    const lines = content
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    // Skip header row
    const words = lines.slice(1);
    res.json(words);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
