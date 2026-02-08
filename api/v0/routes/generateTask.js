const express = require('express');
const router = express.Router();
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const { generateTier1TaskPrompt, selectPronounWeighted } = require('../prompts/tier1TaskGenerator');
const Progress = require('../models/Progress');
const PronounHistory = require('../models/PronounHistory');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Load words from CSV based on tier
function loadWordsForTier(tier) {
  const tierFiles = {
    1: path.join(__dirname, '..', 'tier1.csv'),
    2: path.join(__dirname, '..', 'tier2.csv'),
  };

  const filePath = tierFiles[tier];
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`No word list found for tier ${tier}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());
  const words = [];

  for (let i = 1; i < lines.length; i++) {
    const [word, tierNum] = lines[i].split(',');
    if (word && word.trim()) {
      words.push({
        word: word.trim(),
        tier: parseInt(tierNum) || tier
      });
    }
  }

  return words;
}

// Weighted selection for spaced repetition
function selectWord(words, progressRecords) {
  const wordsWithWeights = words.map(w => {
    const progress = progressRecords[w.word] || { timesShown: 0, correctCount: 0 };
    // Lower weight = less likely to be selected
    // Higher timesShown and correctCount = lower weight
    const weight = 1 / (1 + progress.timesShown) / (1 + progress.correctCount);
    return { ...w, weight };
  });

  const totalWeight = wordsWithWeights.reduce((sum, w) => sum + w.weight, 0);
  let random = Math.random() * totalWeight;

  for (const word of wordsWithWeights) {
    random -= word.weight;
    if (random <= 0) {
      return word.word;
    }
  }

  return wordsWithWeights[0].word;
}

/**
 * POST /generate-task
 * Generate a dynamic learning task based on tier and task type
 *
 * Body:
 * - tier: number (1-4) - which tier curriculum to use
 * - taskType: 'multipleChoice' | 'reverseTranslation'
 * - focusArea: optional string (e.g., 'verbs', 'articles', 'questions')
 *
 * Returns:
 * - task: object with German/English text and answer choices
 */
router.post('/generate-task', async (req, res) => {
  try {
    const { tier = 1, taskType = 'multipleChoice', focusArea = 'general', userId = 'default' } = req.body;

    // Validate inputs
    if (![1, 2].includes(tier)) {
      return res.status(400).json({ error: 'Invalid tier. Must be 1 or 2.' });
    }

    if (!['multipleChoice', 'reverseTranslation'].includes(taskType)) {
      return res.status(400).json({
        error: 'Invalid taskType. Must be "multipleChoice" or "reverseTranslation".'
      });
    }

    // Load words for the tier
    const words = loadWordsForTier(tier);

    // Load progress for all words
    const progressRecords = {};
    const allProgress = await Progress.find({});
    allProgress.forEach(p => {
      progressRecords[p.word] = {
        timesShown: p.timesShown,
        correctCount: p.correctCount
      };
    });

    // Select a word using weighted selection (spaced repetition)
    const targetWord = selectWord(words, progressRecords);

    console.log(`Selected word: "${targetWord}" for Tier ${tier}`);

    // Get pronoun history and select pronoun with weighted distribution
    let pronounHistory = await PronounHistory.findOne({ userId });
    if (!pronounHistory) {
      pronounHistory = new PronounHistory({ userId, recentPronouns: [] });
    }

    const selectedPronoun = selectPronounWeighted(pronounHistory.recentPronouns);
    console.log(`Selected pronoun: "${selectedPronoun.german}" (${selectedPronoun.english})`);

    // Generate the prompt with target word and preferred pronoun
    const promptConfig = generateTier1TaskPrompt(taskType, {
      focusArea,
      targetWord,
      preferredPronoun: selectedPronoun
    });

    console.log(`Generating ${taskType} task for Tier ${tier} with word "${targetWord}"...`);

    // Call OpenAI
    const completion = await openai.chat.completions.create({
      model: promptConfig.model,
      messages: promptConfig.messages,
      response_format: promptConfig.response_format,
      temperature: promptConfig.temperature,
      max_tokens: promptConfig.max_tokens,
    });

    const taskData = JSON.parse(completion.choices[0].message.content);

    // Validate response structure
    if (taskType === 'multipleChoice') {
      if (!taskData.german || !taskData.correctEnglish || !taskData.wrongOptions) {
        throw new Error('Invalid task structure from LLM');
      }
      if (!Array.isArray(taskData.wrongOptions) || taskData.wrongOptions.length !== 3) {
        throw new Error('Expected exactly 3 wrong options');
      }
    } else if (taskType === 'reverseTranslation') {
      if (!taskData.english || !taskData.correctGerman || !taskData.wrongOptions) {
        throw new Error('Invalid task structure from LLM');
      }
      if (!Array.isArray(taskData.wrongOptions) || taskData.wrongOptions.length !== 3) {
        throw new Error('Expected exactly 3 wrong options');
      }
    }

    console.log('Task generated successfully for word:', targetWord);

    // Update pronoun history
    pronounHistory.recentPronouns.unshift(selectedPronoun.key);
    if (pronounHistory.recentPronouns.length > 12) {
      pronounHistory.recentPronouns = pronounHistory.recentPronouns.slice(0, 12);
    }
    pronounHistory.lastUpdated = new Date();
    await pronounHistory.save();

    console.log(`Updated pronoun history: [${pronounHistory.recentPronouns.slice(0, 6).join(', ')}...]`);

    // Return the task with target word
    res.json({
      task: taskData,
      targetWord,
      tier,
      taskType,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error generating task:', error);
    res.status(500).json({
      error: 'Failed to generate task',
      details: error.message
    });
  }
});

/**
 * POST /submit-answer
 * Submit answer and update progress tracking
 *
 * Body:
 * - targetWord: string - the word being tested
 * - tier: number
 * - taskType: string
 * - userAnswer: string
 * - correctAnswer: string
 * - previousTier: number (optional) - to detect tier unlocks
 *
 * Returns:
 * - correct: boolean
 * - word: string
 * - stats: updated word statistics
 * - tierUnlocked: boolean (true if a tier was just unlocked)
 * - newTier: number (the newly unlocked tier, if any)
 */
router.post('/submit-answer', async (req, res) => {
  try {
    const {
      targetWord,
      tier,
      taskType,
      userAnswer,
      correctAnswer,
      previousTier
    } = req.body;

    // Validate inputs
    if (!targetWord || !tier || !taskType || !userAnswer || !correctAnswer) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check if answer is correct
    const isCorrect = userAnswer.trim() === correctAnswer.trim();

    console.log(`Answer for "${targetWord}": ${isCorrect ? 'CORRECT' : 'WRONG'}`);
    console.log(`  User: "${userAnswer}", Correct: "${correctAnswer}"`);

    // Find or create progress for this word
    let progress = await Progress.findOne({ word: targetWord });

    if (!progress) {
      progress = new Progress({
        word: targetWord,
        tier: tier,
        timesShown: 0,
        correctCount: 0,
        lastSeenTaskType: null
      });
    }

    // Update progress
    progress.timesShown += 1;
    if (isCorrect) {
      progress.correctCount += 1;
    }
    progress.lastSeenTaskType = taskType;

    await progress.save();

    const accuracy = progress.timesShown > 0
      ? progress.correctCount / progress.timesShown
      : 0;

    console.log(`  Progress: ${progress.correctCount}/${progress.timesShown} (${Math.round(accuracy * 100)}%)`);

    // Check if this answer caused a tier unlock
    let tierUnlocked = false;
    let newTier = null;

    // Only check if we have a previousTier to compare against
    if (previousTier) {
      // Load tier 1 words and check mastery
      const tier1Words = loadWordsForTier(1);
      const allProgress = await Progress.find({});
      const progressMap = {};
      allProgress.forEach(p => {
        progressMap[p.word] = p;
      });

      let tier1MasteredCount = 0;
      tier1Words.forEach(w => {
        const prog = progressMap[w.word];
        if (prog) {
          const acc = prog.timesShown > 0 ? prog.correctCount / prog.timesShown : 0;
          if (prog.timesShown >= 7 && acc >= 0.75) {
            tier1MasteredCount++;
          }
        }
      });

      const tier2ShouldBeUnlocked = tier1MasteredCount >= Math.ceil(tier1Words.length * 0.75);
      const currentTier = tier2ShouldBeUnlocked ? 2 : 1;

      // Tier unlock detected
      if (currentTier > previousTier) {
        tierUnlocked = true;
        newTier = currentTier;
        console.log(`🎉 Tier ${newTier} unlocked! ${tier1MasteredCount}/${tier1Words.length} Tier 1 words mastered`);
      }
    }

    // Return updated stats
    res.json({
      correct: isCorrect,
      word: targetWord,
      tier,
      taskType,
      stats: {
        timesShown: progress.timesShown,
        correctCount: progress.correctCount,
        accuracy: Math.round(accuracy * 100)
      },
      tierUnlocked,
      newTier,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error submitting answer:', error);
    res.status(500).json({
      error: 'Failed to submit answer',
      details: error.message
    });
  }
});

/**
 * GET /tier-stats
 * Get tier-based statistics from word progress
 *
 * Returns:
 * - currentTier: number (determined by mastery)
 * - tierStats: array of tier statistics with unlock status
 * - overallAccuracy: number
 * - totalWords: number
 */
router.get('/tier-stats', async (req, res) => {
  try {
    // Load all progress
    const allProgress = await Progress.find({});

    // Load tier words
    const tier1Words = loadWordsForTier(1);
    const tier2Words = loadWordsForTier(2);

    // Calculate stats for each tier
    const calculateTierStats = (tierWords, tierNum) => {
      const progressMap = {};
      allProgress.forEach(p => {
        progressMap[p.word] = p;
      });

      let totalAttempts = 0;
      let correctAttempts = 0;
      let masteredCount = 0;

      tierWords.forEach(w => {
        const prog = progressMap[w.word];
        if (prog) {
          totalAttempts += prog.timesShown;
          correctAttempts += prog.correctCount;

          // Mastery criteria: 7+ attempts AND 75%+ accuracy
          const accuracy = prog.timesShown > 0 ? prog.correctCount / prog.timesShown : 0;
          if (prog.timesShown >= 7 && accuracy >= 0.75) {
            masteredCount++;
          }
        }
      });

      const accuracy = totalAttempts > 0 ? correctAttempts / totalAttempts : 0;
      const masteryPercentage = Math.round((masteredCount / tierWords.length) * 100);

      return {
        tier: tierNum,
        total: tierWords.length,
        mastered: masteredCount,
        percentage: masteryPercentage,
        totalAttempts,
        accuracy: Math.round(accuracy * 100),
        unlocked: false, // Will be set below
        masteryPercentage // For unlock logic
      };
    };

    const tier1Stats = calculateTierStats(tier1Words, 1);
    const tier2Stats = calculateTierStats(tier2Words, 2);

    // Determine tier unlocking
    // Tier 1 is always unlocked
    tier1Stats.unlocked = true;

    // Tier 2 unlocks when 75% of Tier 1 words are mastered
    const tier2Unlocked = tier1Stats.mastered >= Math.ceil(tier1Words.length * 0.75);
    tier2Stats.unlocked = tier2Unlocked;

    // Current tier is the highest unlocked tier
    const currentTier = tier2Unlocked ? 2 : 1;

    const tierStatsArray = [tier1Stats, tier2Stats];

    // Calculate overall stats
    const totalAttempts = allProgress.reduce((sum, p) => sum + p.timesShown, 0);
    const totalCorrect = allProgress.reduce((sum, p) => sum + p.correctCount, 0);
    const overallAccuracy = totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : 0;

    // Get per-word progress for current tier
    const currentTierWords = currentTier === 1 ? tier1Words : tier2Words;
    const progressMap = {};
    allProgress.forEach(p => {
      progressMap[p.word] = p;
    });

    const wordProgress = currentTierWords.map(w => {
      const prog = progressMap[w.word];
      if (!prog) {
        return { word: w.word, attempts: 0, accuracy: 0 };
      }
      const accuracy = prog.timesShown > 0 ? prog.correctCount / prog.timesShown : 0;
      return {
        word: w.word,
        attempts: prog.timesShown,
        accuracy: Math.round(accuracy * 100)
      };
    });

    console.log(`Tier progression: Tier 1 mastered ${tier1Stats.mastered}/${tier1Words.length} (${tier1Stats.percentage}%), Tier 2 ${tier2Unlocked ? 'UNLOCKED' : 'locked'}`);

    res.json({
      currentTier,
      tierStats: tierStatsArray,
      overallAccuracy,
      totalWords: tier1Words.length + tier2Words.length,
      totalAttempts,
      wordProgress // Per-word progress for current tier
    });

  } catch (error) {
    console.error('Error fetching tier stats:', error);
    res.status(500).json({
      error: 'Failed to fetch tier stats',
      details: error.message
    });
  }
});

module.exports = router;
