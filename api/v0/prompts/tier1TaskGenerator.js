/**
 * Tier 1 Task Generator Prompt
 * Generates dynamic German learning tasks based on Tier 1 curriculum
 */

const TIER_1_CONTEXT = `
# Tier 1: Core Grammar (0-100 words)
**Learn WITH first nouns/verbs**

## Grammar Elements
- Personal pronouns: ich, du, er, sie, es, wir, ihr, sie, Sie
- Articles: der/die/das, ein/eine/ein
- Essential verbs: sein & haben (full conjugations)
  - sein: ich bin, du bist, er/sie/es ist, wir sind, ihr seid, sie sind
  - haben: ich habe, du hast, er/sie/es hat, wir haben, ihr habt, sie haben
- Basic word order: Subject-Verb-Object

## Vocabulary Breakdown (First 100 Words)

**Nouns with articles (35):**
der Hund, die Katze, das Haus, der Apfel, das Brot, die Milch, das Wasser, der Tisch,
die Tür, das Fenster, der Mann, die Frau, das Kind, der Tag, die Nacht, das Bett,
der Stuhl, die Schule, das Auto, der Bus, die Straße, das Essen, der Kaffee, die Stadt,
das Land, der Freund, die Familie, das Geld, der Morgen, die Hand, der Kopf, das Auge,
die Arbeit, der Name, das Jahr

**Verbs (20):**
sein, haben, gehen, kommen, machen, essen, trinken, sehen, sagen, denken, schlafen,
arbeiten, wohnen, heißen, sprechen, verstehen, brauchen, mögen, wollen, können

**Pronouns (10):**
ich, du, er, sie, es, wir, ihr, sie (plural), Sie (formal), mein

**Common function words (25):**
und, aber, oder, in, auf, mit, zu, von, nach, der, die, das (as demonstratives), ein, eine,
kein, keine, nicht, auch, sehr, hier, dort, jetzt, dann, immer, gut

**Question words (5):**
was, wer, wo, wie, wann

**Adjectives/descriptors (5):**
gut, groß, klein, alt, neu

## Capabilities at 100 words
- Can form basic sentences: "Ich bin müde" (I am tired)
- Can ask simple questions: "Wo ist das Brot?" (Where is the bread?)
- Can express possession: "Das ist mein Hund" (That is my dog)
- Can introduce yourself: "Ich heiße Maria. Ich komme aus Spanien."

## Teaching Method
**Implicit pattern learning** - NO explicit grammar rules yet
- Teach chunks: "Ich bin...", "Das ist...", "Wo ist...?"
- Show patterns through examples
- Focus on high-frequency combinations
`;

/**
 * Generate a task creation prompt for multiple choice
 * @param {string} taskType - 'multipleChoice' or 'reverseTranslation'
 * @param {object} options - Additional options for task generation
 * @returns {object} OpenAI chat completion messages
 */
function generateTier1TaskPrompt(taskType = 'multipleChoice', options = {}) {
  const { focusArea = 'general', difficulty = 'beginner' } = options;

  const systemPrompt = `You are a German language teaching assistant specializing in beginner-level (Tier 1) instruction.

Your role is to generate effective learning tasks that help students build foundational German skills through pattern recognition and high-frequency chunks.

${TIER_1_CONTEXT}

IMPORTANT GUIDELINES:
1. Tasks should use ONLY vocabulary and grammar from Tier 1 listed above
2. Focus on teaching chunks and patterns, not isolated words
3. Prefer common, practical phrases students can use immediately
4. Include articles with nouns (der Hund, die Katze, das Haus)
5. Use simple conjugations of sein and haben
6. Keep sentences in Subject-Verb-Object order
7. No explicit grammar explanations - teach through examples
8. Ensure all wrong answer choices are plausible but clearly incorrect`;

  let userPrompt = '';

  if (taskType === 'multipleChoice') {
    userPrompt = `Generate a multiple choice task for Tier 1 German learners.

TASK FORMAT: Show German text, student selects English translation

REQUIREMENTS:
- Use Tier 1 vocabulary and patterns only
- German text can be: a single word with article, a chunk, or a simple sentence
- Provide 1 correct English translation
- Provide 3 wrong but plausible English options
- Wrong options should test understanding (not random words)

EXAMPLES OF GOOD TASKS:
- "der Hund" → correct: "the dog", wrong: ["the cat", "a dog", "the dogs"]
- "Ich bin müde" → correct: "I am tired", wrong: ["I am hungry", "You are tired", "I have tired"]
- "Wo ist das Brot?" → correct: "Where is the bread?", wrong: ["Where is the water?", "What is the bread?", "Who is the bread?"]

Return your response as JSON:
{
  "german": "the German text to display",
  "correctEnglish": "the correct English translation",
  "wrongOptions": ["wrong option 1", "wrong option 2", "wrong option 3"],
  "chunkPattern": "optional: the pattern being taught (e.g., 'Wo ist...?', 'Ich bin...')",
  "focusGrammar": "optional: grammar element being reinforced (e.g., 'sein conjugation', 'articles')"
}`;
  } else if (taskType === 'reverseTranslation') {
    userPrompt = `Generate a reverse translation task for Tier 1 German learners.

TASK FORMAT: Show English text, student selects correct German translation

REQUIREMENTS:
- Use Tier 1 vocabulary and patterns only
- English text should be a practical phrase or sentence
- Provide 1 correct German translation
- Provide 3 wrong but plausible German options
- Wrong options should test grammar understanding (wrong article, wrong conjugation, word order, etc.)

EXAMPLES OF GOOD TASKS:
- "the dog" → correct: "der Hund", wrong: ["die Hund", "das Hund", "ein Hund"]
- "I am tired" → correct: "Ich bin müde", wrong: ["Ich habe müde", "Du bist müde", "Ich müde bin"]
- "Where is the bread?" → correct: "Wo ist das Brot?", wrong: ["Wo das Brot ist?", "Was ist das Brot?", "Wo ist der Brot?"]

Return your response as JSON:
{
  "english": "the English text to display",
  "correctGerman": "the correct German translation",
  "wrongOptions": ["wrong option 1", "wrong option 2", "wrong option 3"],
  "chunkPattern": "optional: the pattern being taught (e.g., 'Wo ist...?', 'Ich bin...')",
  "focusGrammar": "optional: grammar element being reinforced (e.g., 'articles', 'verb conjugation')"
}`;
  }

  return {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    temperature: 0.8, // Slightly higher for variety in task generation
    max_tokens: 500
  };
}

module.exports = {
  generateTier1TaskPrompt,
  TIER_1_CONTEXT
};
