const mongoose = require('mongoose');

const progressSchema = new mongoose.Schema({
  word: { type: String, required: true, unique: true, index: true },
  tier: { type: Number, default: 1 }, // Kept for backward compatibility
  level: { type: String, default: 'A1' }, // New: A1, A2, B1
  timesShown: { type: Number, default: 0 },
  correctCount: { type: Number, default: 0 },
  lastSeenTaskType: { type: String, default: null },
}, { timestamps: true });

module.exports = mongoose.model('Progress', progressSchema);
