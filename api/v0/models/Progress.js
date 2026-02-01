const mongoose = require('mongoose');

const progressSchema = new mongoose.Schema({
  word: { type: String, required: true, unique: true, index: true },
  correctStreak: { type: Number, default: 0 },
  totalReviews: { type: Number, default: 0 },
  nextShowAfter: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('Progress', progressSchema);
