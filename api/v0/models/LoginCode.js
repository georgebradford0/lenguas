const mongoose = require('mongoose');

const loginCodeSchema = new mongoose.Schema({
  userId:    { type: String, required: true },
  code:      { type: String, required: true },
  expiresAt: { type: Date, required: true },
});

// MongoDB TTL index: automatically delete documents after expiresAt
loginCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('LoginCode', loginCodeSchema);
