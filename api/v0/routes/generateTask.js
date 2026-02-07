const express = require('express');
const router = express.Router();
const OpenAI = require('openai');
const { generateTier1TaskPrompt } = require('../prompts/tier1TaskGenerator');
const TierProgress = require('../models/TierProgress');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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
    if (![1, 2, 3, 4].includes(tier)) {
      return res.status(400).json({ error: 'Invalid tier. Must be 1-4.' });
    }

    if (!['multipleChoice', 'reverseTranslation'].includes(taskType)) {
      return res.status(400).json({
        error: 'Invalid taskType. Must be "multipleChoice" or "reverseTranslation".'
      });
    }

    // For now, only Tier 1 is implemented
    if (tier !== 1) {
      return res.status(501).json({
        error: `Tier ${tier} task generation not yet implemented.`
      });
    }

    // Generate the prompt
    const promptConfig = generateTier1TaskPrompt(taskType, { focusArea });

    console.log(`Generating ${taskType} task for Tier ${tier}...`);

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

    console.log('Task generated successfully:', taskData);

    // Return the task
    res.json({
      task: taskData,
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
 * - userId: string (optional, defaults to 'default-user')
 * - tier: number
 * - taskType: string
 * - userAnswer: string
 * - correctAnswer: string
 * - taskData: object (the original task for logging)
 *
 * Returns:
 * - correct: boolean
 * - stats: updated tier statistics
 * - tierUnlocked: boolean (true if next tier was just unlocked)
 */
router.post('/submit-answer', async (req, res) => {
  try {
    const {
      userId = 'default-user',
      tier,
      taskType,
      userAnswer,
      correctAnswer,
      taskData
    } = req.body;

    // Validate inputs
    if (!tier || !taskType || !userAnswer || !correctAnswer) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check if answer is correct
    const isCorrect = userAnswer.trim() === correctAnswer.trim();

    console.log(`Answer submitted: ${isCorrect ? 'CORRECT' : 'WRONG'}`);
    console.log(`  User: "${userAnswer}", Correct: "${correctAnswer}"`);

    // Find or create user's progress
    const progress = await TierProgress.findOrCreateForUser(userId);

    // Update tier statistics
    const tierKey = `tier${tier}`;
    const tierStats = progress.tierStats[tierKey];

    tierStats.totalAttempts += 1;
    if (isCorrect) {
      tierStats.correctAttempts += 1;
    }

    // Update task-type-specific stats
    if (taskType === 'multipleChoice') {
      tierStats.multipleChoiceAttempts += 1;
      if (isCorrect) {
        tierStats.multipleChoiceCorrect += 1;
      }
    } else if (taskType === 'reverseTranslation') {
      tierStats.reverseTranslationAttempts += 1;
      if (isCorrect) {
        tierStats.reverseTranslationCorrect += 1;
      }
    }

    // Update overall stats
    progress.totalTasksCompleted += 1;
    progress.lastStudyDate = new Date();

    // Check if next tier should be unlocked
    let tierUnlocked = false;
    if (progress.shouldUnlockNextTier()) {
      tierUnlocked = progress.unlockNextTier();
      console.log(`🎉 Tier ${progress.currentTier} unlocked for user ${userId}!`);
    }

    await progress.save();

    // Return updated stats
    res.json({
      correct: isCorrect,
      tier,
      taskType,
      tierUnlocked,
      currentTier: progress.currentTier,
      stats: {
        accuracy: progress.getTierAccuracy(tier),
        totalAttempts: tierStats.totalAttempts,
        correctAttempts: tierStats.correctAttempts,
        overallAccuracy: progress.overallAccuracy
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
 * GET /tier-progress
 * Get user's tier progress and statistics
 *
 * Query params:
 * - userId: string (optional, defaults to 'default-user')
 *
 * Returns:
 * - currentTier: number
 * - tierStats: object with stats for each tier
 * - overallAccuracy: number
 * - totalTasksCompleted: number
 */
router.get('/tier-progress', async (req, res) => {
  try {
    const { userId = 'default-user' } = req.query;

    const progress = await TierProgress.findOrCreateForUser(userId);

    res.json({
      userId: progress.userId,
      currentTier: progress.currentTier,
      tierStats: progress.tierStats,
      overallAccuracy: progress.overallAccuracy,
      totalTasksCompleted: progress.totalTasksCompleted,
      currentStreak: progress.currentStreak,
      longestStreak: progress.longestStreak,
      lastStudyDate: progress.lastStudyDate
    });

  } catch (error) {
    console.error('Error fetching tier progress:', error);
    res.status(500).json({
      error: 'Failed to fetch tier progress',
      details: error.message
    });
  }
});

module.exports = router;
