const mongoose = require('mongoose');

const progressSchema = new mongoose.Schema({
  word: { type: String, required: true, unique: true, index: true },
  timesShown: { type: Number, default: 0 },
  correctCount: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('Progress', progressSchema);
