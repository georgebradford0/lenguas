/**
 * Test script for word-injection task generation
 * Run with: node test-word-injection.js
 */

require('dotenv').config();
const OpenAI = require('openai');
const { generateTier1TaskPrompt } = require('./prompts/tier1TaskGenerator');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function testWordInjection(targetWord, taskType) {
  console.log(`\n=== Testing ${taskType} with word "${targetWord}" ===\n`);

  const promptConfig = generateTier1TaskPrompt(taskType, { targetWord });

  const completion = await openai.chat.completions.create({
    model: promptConfig.model,
    messages: promptConfig.messages,
    response_format: promptConfig.response_format,
    temperature: promptConfig.temperature,
    max_tokens: promptConfig.max_tokens,
  });

  const task = JSON.parse(completion.choices[0].message.content);

  console.log('Generated Task:');
  if (taskType === 'multipleChoice') {
    console.log('German:', task.german);
    console.log('Correct English:', task.correctEnglish);
    console.log('Wrong Options:', task.wrongOptions);
  } else {
    console.log('English:', task.english);
    console.log('Correct German:', task.correctGerman);
    console.log('Wrong Options:', task.wrongOptions);
  }
  console.log('Chunk Pattern:', task.chunkPattern);
  console.log('Focus Grammar:', task.focusGrammar);

  // Verify word is in the task
  const germanText = taskType === 'multipleChoice' ? task.german : task.correctGerman;
  if (germanText.includes(targetWord)) {
    console.log(`✓ Target word "${targetWord}" found in task!`);
  } else {
    console.log(`✗ WARNING: Target word "${targetWord}" NOT found in task!`);
  }

  return task;
}

async function runTests() {
  try {
    // Test with different words
    await testWordInjection('der Hund', 'multipleChoice');
    await testWordInjection('haben', 'reverseTranslation');
    await testWordInjection('das Wasser', 'multipleChoice');

    console.log('\n✓ All tests completed!\n');
  } catch (error) {
    console.error('\n✗ Test failed:', error.message);
    console.error(error);
  }
}

if (require.main === module) {
  runTests();
}

module.exports = { testWordInjection };
