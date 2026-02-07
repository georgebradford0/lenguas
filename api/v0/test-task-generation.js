/**
 * Test script for LLM-based task generation system
 * Run with: node test-task-generation.js
 */

require('dotenv').config();
const OpenAI = require('openai');
const { generateTier1TaskPrompt } = require('./prompts/tier1TaskGenerator');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function testMultipleChoiceGeneration() {
  console.log('\n=== Testing Multiple Choice Task Generation ===\n');

  const promptConfig = generateTier1TaskPrompt('multipleChoice');

  const completion = await openai.chat.completions.create({
    model: promptConfig.model,
    messages: promptConfig.messages,
    response_format: promptConfig.response_format,
    temperature: promptConfig.temperature,
    max_tokens: promptConfig.max_tokens,
  });

  const task = JSON.parse(completion.choices[0].message.content);

  console.log('Generated Task:');
  console.log('German:', task.german);
  console.log('Correct English:', task.correctEnglish);
  console.log('Wrong Options:', task.wrongOptions);
  console.log('Chunk Pattern:', task.chunkPattern);
  console.log('Focus Grammar:', task.focusGrammar);

  return task;
}

async function testReverseTranslationGeneration() {
  console.log('\n=== Testing Reverse Translation Task Generation ===\n');

  const promptConfig = generateTier1TaskPrompt('reverseTranslation');

  const completion = await openai.chat.completions.create({
    model: promptConfig.model,
    messages: promptConfig.messages,
    response_format: promptConfig.response_format,
    temperature: promptConfig.temperature,
    max_tokens: promptConfig.max_tokens,
  });

  const task = JSON.parse(completion.choices[0].message.content);

  console.log('Generated Task:');
  console.log('English:', task.english);
  console.log('Correct German:', task.correctGerman);
  console.log('Wrong Options:', task.wrongOptions);
  console.log('Chunk Pattern:', task.chunkPattern);
  console.log('Focus Grammar:', task.focusGrammar);

  return task;
}

async function testMultipleTasks() {
  console.log('\n=== Testing Task Variety (5 tasks) ===\n');

  for (let i = 1; i <= 5; i++) {
    console.log(`\nTask ${i}:`);
    const promptConfig = generateTier1TaskPrompt('multipleChoice');

    const completion = await openai.chat.completions.create({
      model: promptConfig.model,
      messages: promptConfig.messages,
      response_format: promptConfig.response_format,
      temperature: promptConfig.temperature,
      max_tokens: promptConfig.max_tokens,
    });

    const task = JSON.parse(completion.choices[0].message.content);
    console.log(`  German: "${task.german}"`);
    console.log(`  Pattern: ${task.chunkPattern || 'N/A'}`);
  }
}

async function runTests() {
  try {
    await testMultipleChoiceGeneration();
    await testReverseTranslationGeneration();
    await testMultipleTasks();

    console.log('\n✓ All tests completed successfully!\n');
  } catch (error) {
    console.error('\n✗ Test failed:', error.message);
    console.error(error);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests();
}

module.exports = {
  testMultipleChoiceGeneration,
  testReverseTranslationGeneration,
  testMultipleTasks
};
