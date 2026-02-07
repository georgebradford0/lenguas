const mongoose = require('mongoose');

/**
 * TierProgress Schema
 * Tracks learner progress at the tier level (not individual words)
 *
 * This model supports the LLM-generated task approach where:
 * - Tasks are dynamically generated based on tier curriculum
 * - Progress is tracked by tier, not by specific vocabulary items
 * - Accuracy metrics guide tier unlocking and task difficulty
 */
const tierProgressSchema = new mongoose.Schema({
  // User identifier (could be userId, sessionId, or device fingerprint)
  userId: {
    type: String,
    required: true,
    index: true,
    default: 'default-user'
  },

  // Current tier (1-4)
  currentTier: {
    type: Number,
    required: true,
    default: 1,
    min: 1,
    max: 4
  },

  // Tier-specific statistics
  tierStats: {
    tier1: {
      totalAttempts: { type: Number, default: 0 },
      correctAttempts: { type: Number, default: 0 },
      multipleChoiceAttempts: { type: Number, default: 0 },
      multipleChoiceCorrect: { type: Number, default: 0 },
      reverseTranslationAttempts: { type: Number, default: 0 },
      reverseTranslationCorrect: { type: Number, default: 0 },
      unlocked: { type: Boolean, default: true },
      unlockedAt: { type: Date, default: Date.now }
    },
    tier2: {
      totalAttempts: { type: Number, default: 0 },
      correctAttempts: { type: Number, default: 0 },
      multipleChoiceAttempts: { type: Number, default: 0 },
      multipleChoiceCorrect: { type: Number, default: 0 },
      reverseTranslationAttempts: { type: Number, default: 0 },
      reverseTranslationCorrect: { type: Number, default: 0 },
      unlocked: { type: Boolean, default: false },
      unlockedAt: { type: Date, default: null }
    },
    tier3: {
      totalAttempts: { type: Number, default: 0 },
      correctAttempts: { type: Number, default: 0 },
      multipleChoiceAttempts: { type: Number, default: 0 },
      multipleChoiceCorrect: { type: Number, default: 0 },
      reverseTranslationAttempts: { type: Number, default: 0 },
      reverseTranslationCorrect: { type: Number, default: 0 },
      unlocked: { type: Boolean, default: false },
      unlockedAt: { type: Date, default: null }
    },
    tier4: {
      totalAttempts: { type: Number, default: 0 },
      correctAttempts: { type: Number, default: 0 },
      multipleChoiceAttempts: { type: Number, default: 0 },
      multipleChoiceCorrect: { type: Number, default: 0 },
      reverseTranslationAttempts: { type: Number, default: 0 },
      reverseTranslationCorrect: { type: Number, default: 0 },
      unlocked: { type: Boolean, default: false },
      unlockedAt: { type: Date, default: null }
    }
  },

  // Overall statistics
  totalTasksCompleted: {
    type: Number,
    default: 0
  },

  // Study streak tracking
  lastStudyDate: {
    type: Date,
    default: null
  },

  currentStreak: {
    type: Number,
    default: 0
  },

  longestStreak: {
    type: Number,
    default: 0
  }

}, {
  timestamps: true
});

// Virtual: Calculate overall accuracy
tierProgressSchema.virtual('overallAccuracy').get(function() {
  const totalAttempts = this.tierStats.tier1.totalAttempts +
                        this.tierStats.tier2.totalAttempts +
                        this.tierStats.tier3.totalAttempts +
                        this.tierStats.tier4.totalAttempts;

  const totalCorrect = this.tierStats.tier1.correctAttempts +
                       this.tierStats.tier2.correctAttempts +
                       this.tierStats.tier3.correctAttempts +
                       this.tierStats.tier4.correctAttempts;

  return totalAttempts > 0 ? (totalCorrect / totalAttempts) : 0;
});

// Method: Get accuracy for a specific tier
tierProgressSchema.methods.getTierAccuracy = function(tier) {
  const tierKey = `tier${tier}`;
  const stats = this.tierStats[tierKey];

  if (!stats || stats.totalAttempts === 0) return 0;
  return stats.correctAttempts / stats.totalAttempts;
};

// Method: Check if next tier should be unlocked
tierProgressSchema.methods.shouldUnlockNextTier = function() {
  const currentTierKey = `tier${this.currentTier}`;
  const currentStats = this.tierStats[currentTierKey];

  // Unlock criteria: 75% accuracy with at least 20 attempts
  const accuracy = currentStats.totalAttempts > 0
    ? currentStats.correctAttempts / currentStats.totalAttempts
    : 0;

  const UNLOCK_ACCURACY_THRESHOLD = 0.75;
  const UNLOCK_MIN_ATTEMPTS = 20;

  return accuracy >= UNLOCK_ACCURACY_THRESHOLD &&
         currentStats.totalAttempts >= UNLOCK_MIN_ATTEMPTS &&
         this.currentTier < 4;
};

// Method: Unlock next tier
tierProgressSchema.methods.unlockNextTier = function() {
  if (this.currentTier >= 4) {
    return false; // Already at max tier
  }

  const nextTier = this.currentTier + 1;
  const nextTierKey = `tier${nextTier}`;

  this.tierStats[nextTierKey].unlocked = true;
  this.tierStats[nextTierKey].unlockedAt = new Date();
  this.currentTier = nextTier;

  return true;
};

// Static method: Find or create progress for a user
tierProgressSchema.statics.findOrCreateForUser = async function(userId = 'default-user') {
  let progress = await this.findOne({ userId });

  if (!progress) {
    progress = await this.create({ userId });
  }

  return progress;
};

const TierProgress = mongoose.model('TierProgress', tierProgressSchema);

module.exports = TierProgress;
