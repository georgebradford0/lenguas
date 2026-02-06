const express = require('express');
const router = express.Router();
const Progress = require('../models/Progress');

// GET /progress - get all progress records
router.get('/', async (req, res) => {
  try {
    const records = await Progress.find({});
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /progress/:word - get progress for a single word
router.get('/:word', async (req, res) => {
  try {
    const record = await Progress.findOne({ word: req.params.word });
    if (!record) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json(record);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /progress/:word - upsert progress for a word
router.put('/:word', async (req, res) => {
  try {
    const { timesShown, correctCount, tier, lastSeenTaskType } = req.body;
    const updateData = { timesShown, correctCount };
    if (tier !== undefined) updateData.tier = tier;
    if (lastSeenTaskType !== undefined) updateData.lastSeenTaskType = lastSeenTaskType;

    const record = await Progress.findOneAndUpdate(
      { word: req.params.word },
      updateData,
      { upsert: true, new: true, runValidators: true },
    );
    res.json(record);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
