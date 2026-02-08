const mongoose = require('mongoose');

const pronounHistorySchema = new mongoose.Schema({
  userId: { type: String, default: 'default', index: true }, // For future multi-user support
  recentPronouns: {
    type: [String],
    default: [],
    validate: {
      validator: function(arr) {
        return arr.length <= 12; // Keep last 12 pronouns
      }
    }
  },
  lastUpdated: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('PronounHistory', pronounHistorySchema);
