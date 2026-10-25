// Exercises POST /translate/sentence end to end against a scripted fake model, so
// the verbatim guarantees (repair, retry, whole-sentence fallback) are tested
// without network access or an API key.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const Module = require('module');

// Fake model: each call pops the next scripted answer.
let script = [], calls = 0, lastSystem = '', lastReq = null;
class FakeOpenAI { constructor() { this.chat = { completions: { create: async (req) => {
  calls++; lastSystem = req.messages[0].content; lastReq = req;
  const next = script.shift();
  if (!next) throw new Error('script exhausted');
  return { choices: [{ message: { content: JSON.stringify(next) } }] };
} } }; } }
const origLoad = Module._load;
Module._load = function (request, ...rest) { return request === 'openai' ? FakeOpenAI : origLoad.call(this, request, ...rest); };

const express = require('express');
const router = require('../routes/translate');
const app = express(); app.use(express.json()); app.use('/translate', router);

const S = 'Wen das Leben vergnügt, dem ist der Beifall innigst willkommen.';
const word = (w, pos = 'noun') => ({ word: w, pos, translation: 't', explanation: null, usageInSentence: null, usageInGeneral: null });
const good = {
  translation: 'whole',
  chunks: [{ original: 'Wen das Leben vergnügt,', translation: 'a' }, { original: 'dem ist der Beifall innigst willkommen.', translation: 'b' }],
  words: [word('Leben'), word('innigst', 'adverb')],
};
const post = async (port) => (await fetch(`http://localhost:${port}/translate/sentence`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sentence: S, language: 'de' }) })).json();

let server, port;
before(async () => {
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  port = server.address().port;
});
after(() => server.close());

const run = async (answers) => {
  script = answers.slice();
  calls = 0;
  return post(port);
};

test('model rewrites "innigst" -> "inniglich" in chunk AND word: output uses the source, 1 model call', async () => {
  const out = await run([{
    ...good,
    chunks: [good.chunks[0], { original: 'dem ist der Beifall inniglich willkommen.', translation: 'b' }],
    words: [word('Leben'), word('inniglich', 'adverb')],
  }]);
  assert.strictEqual(calls, 1);
  assert.strictEqual(out.chunks[1].original, 'dem ist der Beifall innigst willkommen.');
  assert.deepStrictEqual(out.words.map(w => w.word), ['Leben', 'innigst']);
  assert.ok(!JSON.stringify(out).includes('inniglich'));
});

test('model drops a word, then gets it right on retry: retried once, retry note sent', async () => {
  const out = await run([
    { ...good, chunks: [good.chunks[0], { original: 'dem ist Beifall innigst willkommen.', translation: 'b' }] },
    good,
  ]);
  assert.strictEqual(calls, 2);
  assert.ok(lastSystem.includes('did not reproduce the sentence word-for-word'));
  assert.strictEqual(out.chunks.map(c => c.original).join(' '), S);
});

test('model fails twice: falls back to ONE whole-sentence chunk equal to the source', async () => {
  const out = await run([
    { ...good, chunks: [{ original: 'Wen das Leben vergnügt,', translation: 'a' }, { original: 'dem ist Beifall innigst willkommen.', translation: 'b' }] },
    { ...good, chunks: [{ original: 'Wen das vergnügt,', translation: 'a' }, { original: 'dem ist der Beifall innigst willkommen.', translation: 'b' }] },
  ]);
  assert.strictEqual(calls, 2);
  assert.deepStrictEqual(out.chunks, [{ original: S, translation: 'whole' }]);
});

test('model returns no chunks: retried, then falls back', async () => {
  const out = await run([{ ...good, chunks: [] }, { ...good, chunks: [] }]);
  assert.strictEqual(calls, 2);
  assert.strictEqual(out.chunks[0].original, S);
});

test('clean answer passes through with one call and unchanged chunks', async () => {
  const out = await run([good]);
  assert.strictEqual(calls, 1);
  assert.deepStrictEqual(out.chunks.map(c => c.original), good.chunks.map(c => c.original));
});

test('language "la" is prompted as Latin, not silently as German', async () => {
  script = [good];
  await (await fetch(`http://localhost:${port}/translate/sentence`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sentence: S, language: 'la' }) })).json();
  assert.ok(lastSystem.startsWith('You are a Latin-English language expert'));
  assert.ok(!lastSystem.includes('German'));
});

test('requests low reasoning effort and the OpenAI token-limit parameter', async () => {
  await run([good]);
  assert.strictEqual(lastReq.reasoning_effort, 'low');
  assert.ok(lastReq.max_completion_tokens > 0);
  assert.ok(!('max_tokens' in lastReq) && !('temperature' in lastReq));
});

test('sentence prompt no longer asks for per-word usage notes; response keeps the null fields', async () => {
  const out = await run([{ ...good, words: [word('Leben'), { ...word('innigst', 'adverb'), usageInSentence: 'x', usageInGeneral: 'y' }] }]);
  assert.ok(!lastSystem.includes('usageInSentence') && !lastSystem.includes('usageInGeneral'));
  assert.deepStrictEqual(out.words.map(w => [w.usageInSentence, w.usageInGeneral]), [[null, null], [null, null]]);
});

const postWord = async (body) => {
  const res = await fetch(`http://localhost:${port}/translate/word`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

test('/translate/word returns usage notes for one word with one cheap model call', async () => {
  script = [{ usageInSentence: ' Marks Beifall as nominative. ', usageInGeneral: 'The masculine article.' }];
  calls = 0;
  const r = await postWord({ word: 'der', sentence: S, language: 'de', pos: 'article' });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body, { usageInSentence: 'Marks Beifall as nominative.', usageInGeneral: 'The masculine article.' });
  assert.strictEqual(calls, 1);
  assert.strictEqual(lastReq.reasoning_effort, 'low');
  assert.ok(lastReq.messages[1].content.includes('Word (article): der'));
});

test('/translate/word nulls missing/blank fields and validates input', async () => {
  script = [{ usageInSentence: '  ', usageInGeneral: 5 }];
  assert.deepStrictEqual((await postWord({ word: 'der', sentence: S })).body, { usageInSentence: null, usageInGeneral: null });
  assert.strictEqual((await postWord({ sentence: S })).status, 400);
  assert.strictEqual((await postWord({ word: 'der', sentence: '  ' })).status, 400);
  assert.strictEqual((await postWord({ word: 42, sentence: S })).status, 400);
});

test('hallucinated word entry is dropped, real ones kept', async () => {
  const out = await run([{ ...good, words: [word('Leben'), word('Katze'), word('Beifall')] }]);
  assert.deepStrictEqual(out.words.map(w => w.word), ['Leben', 'Beifall']);
});
