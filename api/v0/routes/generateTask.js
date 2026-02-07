const express = require('express');
const router = express.Router();
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const { generateTier1TaskPrompt } = require('../prompts/tier1TaskGenerator');
const Progress = require('../models/Progress');

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
    const { tier = 1, taskType = 'multipleChoice', focusArea = 'general' } = req.body;

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

    // Generate the prompt with target word
    const promptConfig = generateTier1TaskPrompt(taskType, { focusArea, targetWord });

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
 *
 * Returns:
 * - correct: boolean
 * - word: string
 * - stats: updated word statistics
 */
router.post('/submit-answer', async (req, res) => {
  try {
    const {
      targetWord,
      tier,
      taskType,
      userAnswer,
      correctAnswer
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
 * - currentTier: number (always 1 for now, can add tier unlocking logic later)
 * - tierStats: array of tier statistics
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

          const accuracy = prog.timesShown > 0 ? prog.correctCount / prog.timesShown : 0;
          if (prog.timesShown >= 7 && accuracy >= 0.75) {
            masteredCount++;
          }
        }
      });

      const accuracy = totalAttempts > 0 ? correctAttempts / totalAttempts : 0;

      return {
        tier: tierNum,
        total: tierWords.length,
        mastered: masteredCount,
        percentage: Math.round((masteredCount / tierWords.length) * 100),
        totalAttempts,
        accuracy: Math.round(accuracy * 100),
        unlocked: tierNum === 1 // Tier 1 always unlocked
      };
    };

    const tierStatsArray = [
      calculateTierStats(tier1Words, 1),
      calculateTierStats(tier2Words, 2)
    ];

    // Calculate overall stats
    const totalAttempts = allProgress.reduce((sum, p) => sum + p.timesShown, 0);
    const totalCorrect = allProgress.reduce((sum, p) => sum + p.correctCount, 0);
    const overallAccuracy = totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : 0;

    res.json({
      currentTier: 1,
      tierStats: tierStatsArray,
      overallAccuracy,
      totalWords: tier1Words.length + tier2Words.length,
      totalAttempts
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
