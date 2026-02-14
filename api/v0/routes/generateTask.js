const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const Progress = require('../models/Progress');
const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Load vocabulary from JSON files
function loadVocabulary(level) {
  const levelFiles = {
    'A1': path.join(__dirname, '..', 'wordlists', 'a1_vocabulary.json'),
    'A2': path.join(__dirname, '..', 'wordlists', 'a2_vocabulary.json'),
    'B1': path.join(__dirname, '..', 'wordlists', 'b1_vocabulary.json'),
  };

  const filePath = levelFiles[level];
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`No vocabulary found for level ${level}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
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
      return word;
    }
  }

  return wordsWithWeights[0];
}

// Generate wrong answer choices that are similar but incorrect
function generateDistractors(targetWord, allWords, count = 3) {
  // Filter out the target word and shuffle
  const candidates = allWords
    .filter(w => w.word !== targetWord.word)
    .sort(() => Math.random() - 0.5);

  // Prefer words with same part of speech for better distractors
  const samePOS = candidates.filter(w => w.pos === targetWord.pos);
  const otherPOS = candidates.filter(w => w.pos !== targetWord.pos);

  // Take 2 from same POS and 1 from other POS if possible
  const distractors = [
    ...samePOS.slice(0, 2),
    ...otherPOS.slice(0, 1),
    ...candidates.slice(0, count), // fallback to any words
  ].slice(0, count);

  return distractors.map(w => w.full_entry);
}

// Translate German word to English using OpenAI
async function translateWord(germanWord) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a German-English translator. Translate the given German word or phrase to English. Give ONLY the English translation, nothing else. Keep it brief (1-5 words).',
        },
        { role: 'user', content: germanWord },
      ],
      temperature: 0.3,
      max_tokens: 20,
    });
    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error('Translation error:', error);
    return germanWord; // Fallback to German if translation fails
  }
}

// Translate multiple words in parallel
async function translateWords(germanWords) {
  const translations = await Promise.all(
    germanWords.map(word => translateWord(word))
  );
  return translations;
}

/**
 * POST /generate-task
 * Generate a simple word translation task
 *
 * Body:
 * - level: string ('A1' | 'A2' | 'B1') - which level to use
 * - taskType: 'multipleChoice' | 'reverseTranslation'
 *
 * Returns:
 * - task: object with German/English word and answer choices
 */
router.post('/generate-task', async (req, res) => {
  try {
    const { level = 'A1', taskType = 'multipleChoice', userId = 'default' } = req.body;

    // Validate inputs
    if (!['A1', 'A2', 'B1'].includes(level)) {
      return res.status(400).json({ error: 'Invalid level. Must be A1, A2, or B1.' });
    }

    if (!['multipleChoice', 'reverseTranslation'].includes(taskType)) {
      return res.status(400).json({
        error: 'Invalid taskType. Must be "multipleChoice" or "reverseTranslation".'
      });
    }

    // Load vocabulary for the level
    const vocabulary = loadVocabulary(level);

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
    const targetWord = selectWord(vocabulary, progressRecords);

    console.log(`Selected word: "${targetWord.word}" (${targetWord.pos}) for Level ${level}`);

    // Generate distractors (wrong answers) - these are German words/phrases
    const distractors = generateDistractors(targetWord, vocabulary, 3);

    // Translate to English
    const correctEnglish = await translateWord(targetWord.full_entry);
    const wrongEnglishOptions = await translateWords(distractors);

    console.log(`Translated: "${targetWord.full_entry}" → "${correctEnglish}"`);

    // Build task based on type
    let taskData;

    if (taskType === 'multipleChoice') {
      // Show German word, ask for English translation
      taskData = {
        german: targetWord.full_entry,
        correctEnglish: correctEnglish,
        wrongOptions: wrongEnglishOptions,
      };
    } else {
      // Reverse: show English, ask for German
      taskData = {
        english: correctEnglish,
        correctGerman: targetWord.full_entry,
        wrongOptions: distractors, // Keep German for wrong options
      };
    }

    console.log(`Task generated successfully for word: ${targetWord.word}`);

    // Return the task with target word
    res.json({
      task: taskData,
      targetWord: targetWord.word,
      level,
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
 * - level: string (A1/A2/B1)
 * - taskType: string
 * - userAnswer: string
 * - correctAnswer: string
 * - previousLevel: string (optional) - to detect level unlocks
 *
 * Returns:
 * - correct: boolean
 * - word: string
 * - stats: updated word statistics
 * - levelUnlocked: boolean (true if a level was just unlocked)
 * - newLevel: string (the newly unlocked level, if any)
 */
router.post('/submit-answer', async (req, res) => {
  try {
    const {
      targetWord,
      level,
      taskType,
      userAnswer,
      correctAnswer,
      previousLevel
    } = req.body;

    // Validate inputs
    if (!targetWord || !level || !taskType || !userAnswer || !correctAnswer) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check if answer is correct (case-insensitive, trimmed)
    const isCorrect = userAnswer.trim().toLowerCase() === correctAnswer.trim().toLowerCase();

    console.log(`Answer for "${targetWord}": ${isCorrect ? 'CORRECT' : 'WRONG'}`);
    console.log(`  User: "${userAnswer}", Correct: "${correctAnswer}"`);

    // Find or create progress for this word
    let progress = await Progress.findOne({ word: targetWord });

    if (!progress) {
      progress = new Progress({
        word: targetWord,
        level: level,
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
    progress.level = level; // Update level in case it changed

    await progress.save();

    const accuracy = progress.timesShown > 0
      ? progress.correctCount / progress.timesShown
      : 0;

    console.log(`  Progress: ${progress.correctCount}/${progress.timesShown} (${Math.round(accuracy * 100)}%)`);

    // Check if this answer caused a level unlock
    let levelUnlocked = false;
    let newLevel = null;

    // Only check if we have a previousLevel to compare against
    if (previousLevel) {
      const currentLevel = await determineCurrentLevel();

      // Level unlock detected
      if (currentLevel !== previousLevel) {
        levelUnlocked = true;
        newLevel = currentLevel;
        console.log(`🎉 Level ${newLevel} unlocked!`);
      }
    }

    // Return updated stats
    res.json({
      correct: isCorrect,
      word: targetWord,
      level,
      taskType,
      stats: {
        timesShown: progress.timesShown,
        correctCount: progress.correctCount,
        accuracy: Math.round(accuracy * 100)
      },
      levelUnlocked,
      newLevel,
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
 * Determine current level based on mastery
 * A1 is always available
 * A2 unlocks when 75% of A1 words are mastered (7+ attempts, 75%+ accuracy)
 * B1 unlocks when 75% of A2 words are mastered
 */
async function determineCurrentLevel() {
  const allProgress = await Progress.find({});
  const progressMap = {};
  allProgress.forEach(p => {
    progressMap[p.word] = p;
  });

  // Load vocabularies
  const a1Vocab = loadVocabulary('A1');
  const a2Vocab = loadVocabulary('A2');

  // Calculate A1 mastery
  let a1Mastered = 0;
  a1Vocab.forEach(w => {
    const prog = progressMap[w.word];
    if (prog) {
      const acc = prog.timesShown > 0 ? prog.correctCount / prog.timesShown : 0;
      if (prog.timesShown >= 7 && acc >= 0.75) {
        a1Mastered++;
      }
    }
  });

  const a2Unlocked = a1Mastered >= Math.ceil(a1Vocab.length * 0.75);

  if (!a2Unlocked) {
    return 'A1';
  }

  // Calculate A2 mastery
  let a2Mastered = 0;
  a2Vocab.forEach(w => {
    const prog = progressMap[w.word];
    if (prog) {
      const acc = prog.timesShown > 0 ? prog.correctCount / prog.timesShown : 0;
      if (prog.timesShown >= 7 && acc >= 0.75) {
        a2Mastered++;
      }
    }
  });

  const b1Unlocked = a2Mastered >= Math.ceil(a2Vocab.length * 0.75);

  return b1Unlocked ? 'B1' : 'A2';
}

/**
 * GET /level-stats
 * Get level-based statistics from word progress
 *
 * Returns:
 * - currentLevel: string (A1/A2/B1)
 * - levelStats: array of level statistics with unlock status
 * - overallAccuracy: number
 * - totalWords: number
 */
router.get('/level-stats', async (req, res) => {
  try {
    // Load all progress
    const allProgress = await Progress.find({});

    // Load vocabularies
    const a1Vocab = loadVocabulary('A1');
    const a2Vocab = loadVocabulary('A2');
    const b1Vocab = loadVocabulary('B1');

    // Calculate stats for each level
    const calculateLevelStats = (vocab, levelName) => {
      const progressMap = {};
      allProgress.forEach(p => {
        progressMap[p.word] = p;
      });

      let totalAttempts = 0;
      let correctAttempts = 0;
      let masteredCount = 0;

      vocab.forEach(w => {
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
      const masteryPercentage = Math.round((masteredCount / vocab.length) * 100);

      return {
        level: levelName,
        total: vocab.length,
        mastered: masteredCount,
        percentage: masteryPercentage,
        totalAttempts,
        accuracy: Math.round(accuracy * 100),
        unlocked: false, // Will be set below
      };
    };

    const a1Stats = calculateLevelStats(a1Vocab, 'A1');
    const a2Stats = calculateLevelStats(a2Vocab, 'A2');
    const b1Stats = calculateLevelStats(b1Vocab, 'B1');

    // Determine level unlocking
    // A1 is always unlocked
    a1Stats.unlocked = true;

    // A2 unlocks when 75% of A1 words are mastered
    const a2Unlocked = a1Stats.mastered >= Math.ceil(a1Vocab.length * 0.75);
    a2Stats.unlocked = a2Unlocked;

    // B1 unlocks when 75% of A2 words are mastered
    const b1Unlocked = a2Unlocked && a2Stats.mastered >= Math.ceil(a2Vocab.length * 0.75);
    b1Stats.unlocked = b1Unlocked;

    // Current level is the highest unlocked level
    let currentLevel = 'A1';
    if (b1Unlocked) currentLevel = 'B1';
    else if (a2Unlocked) currentLevel = 'A2';

    const levelStatsArray = [a1Stats, a2Stats, b1Stats];

    // Calculate overall stats
    const totalAttempts = allProgress.reduce((sum, p) => sum + p.timesShown, 0);
    const totalCorrect = allProgress.reduce((sum, p) => sum + p.correctCount, 0);
    const overallAccuracy = totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : 0;

    // Get per-word progress for current level
    const currentLevelVocab = currentLevel === 'A1' ? a1Vocab : currentLevel === 'A2' ? a2Vocab : b1Vocab;
    const progressMap = {};
    allProgress.forEach(p => {
      progressMap[p.word] = p;
    });

    const wordProgress = currentLevelVocab.map(w => {
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

    console.log(`Level progression: A1 ${a1Stats.mastered}/${a1Vocab.length}, A2 ${a2Unlocked ? 'UNLOCKED' : 'locked'}, B1 ${b1Unlocked ? 'UNLOCKED' : 'locked'}`);

    res.json({
      currentLevel,
      levelStats: levelStatsArray,
      overallAccuracy,
      totalWords: a1Vocab.length + a2Vocab.length + b1Vocab.length,
      totalAttempts,
      wordProgress // Per-word progress for current level
    });

  } catch (error) {
    console.error('Error fetching level stats:', error);
    res.status(500).json({
      error: 'Failed to fetch level stats',
      details: error.message
    });
  }
});

// Legacy endpoint for backward compatibility
router.get('/tier-stats', async (req, res) => {
  try {
    const levelStats = await router.handle({ method: 'GET', url: '/level-stats' }, res);
    // Map level names to tier numbers for backward compatibility
    if (levelStats && levelStats.currentLevel) {
      const levelToTier = { 'A1': 1, 'A2': 2, 'B1': 3 };
      levelStats.currentTier = levelToTier[levelStats.currentLevel] || 1;
      levelStats.tierStats = levelStats.levelStats;
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;
