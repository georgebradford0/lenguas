const mongoose = require('mongoose');

const progressSchema = new mongoose.Schema({
  word:             { type: String, required: true, index: true },
  language:         { type: String, required: true, default: 'de' },
  tier:             { type: Number, default: 1 },
  level:            { type: String, default: 'A1' },
  timesShown:       { type: Number, default: 0 },
  correctCount:     { type: Number, default: 0 },
  lastSeenTaskType: { type: String, default: null },
}, { timestamps: true });

progressSchema.index({ word: 1, language: 1 }, { unique: true });

module.exports = mongoose.model('Progress', progressSchema);
