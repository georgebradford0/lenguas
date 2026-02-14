const mongoose = require('mongoose');
const Progress = require('./v0/models/Progress');
const tier1Words = require('./v0/data/tier1Words.json');

async function checkMastery() {
  try {
    await mongoose.connect('mongodb://localhost:27017/language-learning');

    console.log('Total Tier 1 words:', tier1Words.length);

    // Get all progress
    const allProgress = await Progress.find({});
    const progressMap = {};
    allProgress.forEach(p => {
      progressMap[p.word] = p;
    });

    // Check mastery for each word
    let masteredCount = 0;
    let totalCorrectAttempts = 0;
    const notMasteredWords = [];

    tier1Words.forEach(w => {
      const prog = progressMap[w.word];
      if (prog) {
        const acc = prog.correctCount / prog.timesShown;
        totalCorrectAttempts += prog.correctCount;

        if (prog.timesShown >= 7 && acc >= 0.75) {
          masteredCount++;
        } else {
          notMasteredWords.push({
            word: w.word,
            attempts: prog.timesShown,
            accuracy: Math.round(acc * 100),
            needMore: prog.timesShown < 7
              ? `${7 - prog.timesShown} more attempts`
              : `need ${Math.ceil((0.75 - acc) * prog.timesShown)} more correct`
          });
        }
      } else {
        notMasteredWords.push({
          word: w.word,
          attempts: 0,
          accuracy: 0,
          needMore: '7 attempts needed'
        });
      }
    });

    const requiredForTier2 = Math.ceil(tier1Words.length * 0.75);
    const statsBarPercentage = Math.round((totalCorrectAttempts / (tier1Words.length * 7)) * 100);

    console.log('\n=== MASTERY STATUS ===');
    console.log('Mastered words:', masteredCount, '/', tier1Words.length);
    console.log('Required for Tier 2:', requiredForTier2);
    console.log('Tier 2 unlocked?', masteredCount >= requiredForTier2 ? 'YES ✓' : 'NO ✗');
    console.log('\nStatsBar shows:', statsBarPercentage + '%');
    console.log('Actual mastery:', Math.round((masteredCount / tier1Words.length) * 100) + '%');
    console.log('\nWords still needed for unlock:', Math.max(0, requiredForTier2 - masteredCount));

    if (notMasteredWords.length > 0) {
      console.log('\n=== NOT YET MASTERED (first 15) ===');
      notMasteredWords.slice(0, 15).forEach(w => {
        console.log(`${w.word}: ${w.attempts} attempts, ${w.accuracy}% accuracy - ${w.needMore}`);
      });
    }

    await mongoose.connection.close();
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

checkMastery();
