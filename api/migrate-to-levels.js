/**
 * Migration Script: Tier-based to Level-based System
 *
 * This script migrates existing progress data from the old tier system (1/2)
 * to the new level system (A1/A2/B1).
 *
 * Run with: node migrate-to-levels.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Progress = require('./v0/models/Progress');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/language-app';

// Mapping from old tier system to new level system
const TIER_TO_LEVEL = {
  1: 'A1',
  2: 'A2',
  // Any tier 3 or higher becomes B1 (future-proof)
  3: 'B1',
  4: 'B1',
};

async function migrate() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');

    // Find all progress records
    const allProgress = await Progress.find({});
    console.log(`Found ${allProgress.length} progress records`);

    let updated = 0;
    let skipped = 0;

    for (const record of allProgress) {
      // Skip if already has a level
      if (record.level && record.level !== 'A1') {
        console.log(`  Skipping ${record.word} (already has level: ${record.level})`);
        skipped++;
        continue;
      }

      // Determine level from tier
      const tier = record.tier || 1; // Default to tier 1 if not set
      const level = TIER_TO_LEVEL[tier] || 'A1';

      // Update the record
      record.level = level;
      await record.save();

      console.log(`  ✓ Updated ${record.word}: tier ${tier} → level ${level}`);
      updated++;
    }

    console.log('\n=== Migration Complete ===');
    console.log(`  Updated: ${updated} records`);
    console.log(`  Skipped: ${skipped} records`);
    console.log(`  Total: ${allProgress.length} records`);

    await mongoose.connection.close();
    console.log('\nDatabase connection closed');
    process.exit(0);

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
migrate();
