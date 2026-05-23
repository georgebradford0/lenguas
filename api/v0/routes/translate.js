const express = require('express');
const router = express.Router();
const OpenAI = require('openai');
const JSZip = require('jszip');
const { parseDocument, DomUtils, ElementType } = require('htmlparser2');
const he = require('he');

// maxRetries=5: the SDK does exponential backoff on 429/5xx. When the section
// fan-out below bursts 15 parallel calls, occasional rate-limit bumps on
// Tier 3 are expected; this gives the SDK enough headroom to absorb them.
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 5 });

const LANGUAGE_NAMES = { de: 'German', nl: 'Dutch', fr: 'French', es: 'Spanish' };

// ── /translate/sentence ────────────────────────────────────────────────────────
// Translate a full sentence into English and identify every noun and verb in
// the sentence, returning a short English translation and (when grammar is
// non-obvious) an explanation for each.
router.post('/sentence', async (req, res) => {
  try {
    const { sentence, language = 'de' } = req.body;
    if (!sentence || !sentence.trim()) {
      return res.status(400).json({ error: 'sentence is required' });
    }
    const fromLanguage = LANGUAGE_NAMES[language] || 'German';

    const systemPrompt = `You are a ${fromLanguage}-English language expert. Given one ${fromLanguage} sentence, return ONLY valid JSON with this exact shape:

{
  "translation": "<natural English translation of the whole sentence>",
  "chunks": [
    { "original": "<verbatim span of the source sentence>", "translation": "<literal-but-readable English rendering of that span>" }
  ],
  "words": [
    { "word": "<word as it appears in the sentence>", "pos": "noun" | "verb", "translation": "<1-6 word English gloss in this context>", "explanation": "<one short English sentence or null>" }
  ]
}

Rules for "chunks":
- Partition the entire sentence into grammatically coherent chunks: clauses, prepositional phrases, noun phrases with their modifiers, verb groups, etc. Each chunk should be a unit that makes sense to translate together.
- Each "original" must be a VERBATIM contiguous span of the source sentence. Concatenating every chunk's "original" in order, with single spaces between them, must reproduce the sentence (modulo whitespace).
- Do NOT split inside a single word, and keep adjacent punctuation attached to its chunk.
- Each "translation" is a literal-but-readable English rendering of that span on its own — not a full reflowed translation of the whole sentence.
- Aim for 2-6 chunks per typical sentence. Very short sentences may be a single chunk.

Rules for "words":
- "words" contains every noun and every verb in the sentence (including auxiliary, modal, participle, and infinitive verb forms). Exclude articles, prepositions, pronouns, conjunctions, adjectives, adverbs, particles, and numbers.
- "word" must match exactly how the word appears in the sentence — preserve case and inflection. Do NOT lemmatize.
- Include each surface occurrence at most once, in the order they appear.
- "explanation" is a short English sentence only when the word's meaning here is non-obvious or context-dependent (e.g. separable-prefix verb, idiomatic noun usage). Otherwise null.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: sentence.trim() },
      ],
      temperature: 0.1,
      max_tokens: 800,
      response_format: { type: 'json_object' },
    });

    const parsed = JSON.parse(response.choices[0].message.content || '{}');
    const translation = typeof parsed.translation === 'string' ? parsed.translation : '';
    const chunks = Array.isArray(parsed.chunks)
      ? parsed.chunks
          .filter(c => c && typeof c.original === 'string' && c.original.trim() && typeof c.translation === 'string')
          .map(c => ({ original: c.original.trim(), translation: c.translation.trim() }))
      : [];
    // Fallback: if the model returns no chunks, treat the whole sentence as one chunk.
    if (chunks.length === 0) {
      chunks.push({ original: sentence.trim(), translation });
    }
    const words = Array.isArray(parsed.words)
      ? parsed.words
          .filter(w => w && typeof w.word === 'string' && (w.pos === 'noun' || w.pos === 'verb'))
          .map(w => ({
            word: w.word,
            pos: w.pos,
            translation: typeof w.translation === 'string' ? w.translation : '',
            explanation: typeof w.explanation === 'string' && w.explanation.trim() ? w.explanation : null,
          }))
      : [];

    res.json({ translation, chunks, words });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── EPUB text extraction helpers (server-side) ─────────────────────────────────

const BLOCK_TAGS = new Set([
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'li', 'blockquote', 'pre', 'tr', 'br', 'hr',
  'section', 'article', 'aside', 'header', 'footer',
]);

function htmlToText(html) {
  const doc = parseDocument(html, { xmlMode: false });
  const body = DomUtils.findOne(
    el => el.type === ElementType.Tag && el.name === 'body',
    doc.children,
  );
  const root = body || doc;
  const parts = [];
  function walk(node) {
    if (!node) return;
    if (node.type === 'text') {
      parts.push(node.data);
      return;
    }
    if (node.type !== ElementType.Tag) return;
    const name = (node.name || '').toLowerCase();
    const isBlock = BLOCK_TAGS.has(name);
    if (isBlock) parts.push('\n');
    if (node.children) {
      for (const c of node.children) walk(c);
    }
    if (isBlock && name !== 'br' && name !== 'hr') parts.push('\n');
  }
  for (const c of root.children || []) walk(c);
  return he.decode(parts.join(''))
    .split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(l => l.length > 0)
    .join('\n');
}

function extractOpfTitle(opfXml) {
  try {
    const m = opfXml.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i);
    if (m && m[1]) return he.decode(m[1]).trim();
  } catch {}
  return null;
}

function extractOpfAuthor(opfXml) {
  try {
    // Prefer <dc:creator opf:role="aut"> if present; fall back to the first <dc:creator>.
    const authored = opfXml.match(/<dc:creator[^>]*opf:role=["']aut["'][^>]*>([^<]+)<\/dc:creator>/i);
    if (authored && authored[1]) return he.decode(authored[1]).trim();
    const any = opfXml.match(/<dc:creator[^>]*>([^<]+)<\/dc:creator>/i);
    if (any && any[1]) return he.decode(any[1]).trim();
  } catch {}
  return null;
}

async function extractEpubText(epubBuffer) {
  const zip = await JSZip.loadAsync(epubBuffer);

  let title = null;
  let author = null;
  try {
    const containerXml = await zip.file('META-INF/container.xml')?.async('string');
    if (containerXml) {
      const m = containerXml.match(/full-path="([^"]+)"/);
      if (m) {
        const opfXml = await zip.file(m[1])?.async('string');
        if (opfXml) {
          title = extractOpfTitle(opfXml);
          author = extractOpfAuthor(opfXml);
        }
      }
    }
  } catch {}

  const htmlFiles = Object.keys(zip.files)
    .filter(name =>
      /\.(xhtml|html|htm)$/i.test(name) &&
      !name.startsWith('META-INF/') &&
      !zip.files[name].dir,
    )
    .sort();

  const parts = [];
  for (const name of htmlFiles) {
    try {
      const content = await zip.file(name).async('string');
      const text = htmlToText(content);
      if (text.trim().length > 0) parts.push(text);
    } catch (e) {
      console.warn(`[/translate/book] failed to read ${name}:`, e.message);
    }
  }

  return {
    title: title || 'Untitled',
    author: author || null,
    fullText: parts.join('\n\n'),
  };
}

function computeBookId(title, ids) {
  const s = `${title}|${ids.join(',')}|${Date.now()}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// ── /translate/book ────────────────────────────────────────────────────────────
// Takes a raw .epub (base64) and uses gpt-4.1-mini's 1M context to produce a
// fully cleaned-up reader-ready book in one shot. Streams progress as NDJSON.
//
// Body: { epubBase64: string, language: 'de'|'nl'|'fr'|'es', title?: string }
// Response: application/x-ndjson, one event per line:
//   { type: 'progress', phase, message?, current?, total?, sectionId?, title? }
//   { type: 'book', data: <SerializedBook> }
//   { type: 'error', message }
router.post('/book', async (req, res) => {
  const { epubBase64, language = 'de', title: providedTitle } = req.body;
  if (!epubBase64 || typeof epubBase64 !== 'string') {
    return res.status(400).json({ error: 'epubBase64 is required' });
  }
  if (!LANGUAGE_NAMES[language]) {
    return res.status(400).json({ error: `Invalid language. Must be one of: ${Object.keys(LANGUAGE_NAMES).join(', ')}.` });
  }

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (msg) => {
    res.write(JSON.stringify(msg) + '\n');
  };

  const fromLanguage = LANGUAGE_NAMES[language];

  try {
    // ── Phase 1: Extract text from EPUB ─────────────────────────────────────
    send({ type: 'progress', phase: 'extract', message: 'Reading EPUB...' });
    const epubBuffer = Buffer.from(epubBase64, 'base64');
    const { title: extractedTitle, author: extractedAuthor, fullText } = await extractEpubText(epubBuffer);
    // Hint-title used inside the cached bookMessage prefix. Must stay stable across
    // the TOC call and every section call so OpenAI's prompt cache matches.
    const hintTitle = extractedTitle || (providedTitle && providedTitle.trim()) || 'Untitled';
    const hintAuthor = extractedAuthor || null;

    if (!fullText || fullText.length < 200) {
      throw new Error('No readable text found in EPUB');
    }
    console.log(`[/translate/book] hint title "${hintTitle}" — ${fullText.length} chars extracted`);

    // ── Build constant prefix (cached by OpenAI from call 2 onward) ─────────
    const systemPrompt = `You are processing a ${fromLanguage} EPUB book to prepare it for sentence-by-sentence language learning reading.

CRITICAL RULES:
- NEVER translate, paraphrase, summarize, or correct the text. Reproduce ${fromLanguage} text VERBATIM.
- Apply only these structural cleanups:
  * Remove page numbers, running headers, footers, and navigation cruft
  * Merge mid-paragraph line breaks (common in EPUBs converted from PDFs or older scans)
  * Split text into proper sentences (handle abbreviations like "Dr.", "Mr.", "z.B.", "St.", month and weekday abbreviations, etc.)
  * Skip front matter (copyright pages, publisher info, dedications, contents listings)
  * Skip back matter (about the author, advertisements, indexes) unless explicitly requested
- Output VALID JSON only. No prose explanations outside the JSON.`;

    const bookMessage = `Here is the full text of the ${fromLanguage} book "${hintTitle}"${hintAuthor ? ` by ${hintAuthor}` : ''}:

${fullText}`;

    // ── Phase 2: Clean title + TOC ──────────────────────────────────────────
    send({ type: 'progress', phase: 'toc', message: 'Identifying chapters...' });

    const tocPrompt = `Identify the book's metadata and its table of contents. Output JSON with this exact shape:

{
  "title": "<clean, library-display-quality book title>",
  "author": "<author name in 'First Last' form, or null if unknown>",
  "description": "<1-2 sentence neutral summary of the book>",
  "genre": "<short genre label>",
  "difficulty": "<CEFR level: A1 | A2 | B1 | B2 | C1 | C2>",
  "toc": [
    { "id": "ch1", "title": "Chapter title as it appears", "level": 0 }
  ]
}

Rules for "title":
- Use the title as it would appear on the cover or in a library catalog.
- Drop file-naming cruft (underscores, version numbers, "v1.0", "_unabridged"), edition tags like "(Unabridged)" or "[Annotated]", author names appended to the title, and series volume formatting like "- Book 2 of N".
- Preserve original-language spelling and diacritics. Use proper capitalization for the source language (e.g. German nouns capitalized; French/Spanish sentence case).
- If a subtitle is present and short, include it after a colon. Drop long marketing subtitles.

Rules for "author":
- Use the author's commonly-known display name in "First Last" order (e.g. "Franz Kafka", not "Kafka, Franz").
- If multiple authors, join with " & " (e.g. "Jorge Luis Borges & Adolfo Bioy Casares").
- Translators, editors, and illustrators do NOT count — author only.
- If no author can be identified with reasonable confidence, output null. Do NOT guess from training-data memory if the text itself gives no signal.

Rules for "description":
- 1-2 sentences, neutral and factual. Avoid marketing language ("a thrilling tale...", "you won't put it down...").
- Written in English regardless of the source language.
- Focus on what the book is about, not why someone should read it.

Rules for "genre":
- Short label, ideally 1-3 words: "Literary Fiction", "Mystery", "Memoir", "Children's", "Short Stories", "Essays", "Historical Fiction", "Science Fiction", "Poetry", etc.
- Pick the single best fit, not a list.

Rules for "difficulty":
- Estimate the CEFR reading-comprehension level required for a learner of ${fromLanguage}.
- Base it on vocabulary range, sentence complexity, idiomatic density, and assumed cultural knowledge — not book length.
- Children's books are typically A2-B1; literary fiction is typically B2-C1; technical/archaic prose is typically C1-C2.
- Must be exactly one of: A1, A2, B1, B2, C1, C2.

Rules for "toc":
- One entry per chapter or major reading section.
- "id" is a short slug like "ch1", "prologue", "ch_2", "epilogue". Must be unique across the TOC.
- "title" is the chapter title as it appears in the source. If a chapter has no explicit title, generate a brief one like "Chapter 1".
- "level" is 0 for top-level chapters, 1 for nested subsections (rarely needed).
- Skip front matter (copyright, publisher info, dedications, contents page).
- Skip back matter (about the author, advertisements, indexes).
- If the source has no clear chapter breaks, divide into reading units of ~2000-5000 words each.`;

    const tocResponse = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: bookMessage },
        { role: 'user', content: tocPrompt },
      ],
      temperature: 0,
      max_tokens: 4096,
      response_format: { type: 'json_object' },
    });

    const tocJson = JSON.parse(tocResponse.choices[0].message.content || '{}');
    const cleanTitle = typeof tocJson.title === 'string' ? tocJson.title.trim() : '';
    const bookTitle = cleanTitle || hintTitle;
    const cleanAuthor = typeof tocJson.author === 'string' ? tocJson.author.trim() : '';
    const bookAuthor = cleanAuthor || hintAuthor || null;
    const description = typeof tocJson.description === 'string' ? tocJson.description.trim() : '';
    const genre = typeof tocJson.genre === 'string' ? tocJson.genre.trim() : '';
    const rawDifficulty = typeof tocJson.difficulty === 'string' ? tocJson.difficulty.trim().toUpperCase() : '';
    const difficulty = /^(A1|A2|B1|B2|C1|C2)$/.test(rawDifficulty) ? rawDifficulty : null;
    const seenIds = new Set();
    const toc = Array.isArray(tocJson.toc)
      ? tocJson.toc
          .filter(t => t && typeof t.id === 'string' && typeof t.title === 'string')
          .map((t, i) => {
            // Ensure uniqueness; fall back to ch{i} on collision
            let id = String(t.id).trim() || `ch${i + 1}`;
            if (seenIds.has(id)) id = `${id}_${i + 1}`;
            seenIds.add(id);
            return {
              id,
              title: String(t.title).trim(),
              level: Number.isInteger(t.level) ? t.level : 0,
            };
          })
      : [];

    if (toc.length === 0) {
      throw new Error('Could not identify any chapters in this book');
    }
    console.log(`[/translate/book] resolved title "${bookTitle}"${bookAuthor ? ` by ${bookAuthor}` : ''}${difficulty ? ` [${difficulty}]` : ''}, TOC: ${toc.length} entries`);
    send({ type: 'progress', phase: 'toc-done', toc, total: toc.length });

    // ── Phase 3: Reproduce each section ─────────────────────────────────────
    // BATCH_SIZE=15 is tuned for OpenAI Tier 3 on gpt-4.1-mini: fast enough to
    // cut wall-clock on long books, conservative enough to stay under the TPM
    // ceiling when each call carries the full book in its (cached) prefix.
    // The cache is primed by the TOC call above, so every section call here
    // hits the warm [system + bookMessage] prefix regardless of concurrency.
    const sections = {};
    const tocSummary = JSON.stringify({ toc });
    const BATCH_SIZE = 15;
    let done = 0;

    for (let batchStart = 0; batchStart < toc.length; batchStart += BATCH_SIZE) {
      const batch = toc.slice(batchStart, batchStart + BATCH_SIZE);
      await Promise.all(batch.map(async (entry) => {
        const sectionPrompt = `The table of contents you previously identified is:
${tocSummary}

Reproduce the content of section "${entry.id}" (titled "${entry.title}") from the source book. Output JSON with this exact shape:

{
  "paragraphs": [
    ["First sentence.", "Second sentence."],
    ["Single sentence paragraph."]
  ]
}

Rules:
- Each inner array is one paragraph from the source.
- Each string is one sentence in ${fromLanguage}.
- Preserve text VERBATIM (no translation, no paraphrasing).
- Apply the cleanups described in the system prompt.
- Output only the content of THIS section, not adjacent sections.
- If the section has no readable content, output { "paragraphs": [] }.`;

        try {
          const response = await openai.chat.completions.create({
            model: 'gpt-4.1-mini',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: bookMessage },
              { role: 'user', content: sectionPrompt },
            ],
            temperature: 0,
            max_tokens: 16384,
            response_format: { type: 'json_object' },
          });

          const json = JSON.parse(response.choices[0].message.content || '{}');
          const paragraphs = Array.isArray(json.paragraphs)
            ? json.paragraphs.filter(p =>
                Array.isArray(p) && p.length > 0 && p.every(s => typeof s === 'string'))
            : [];
          sections[entry.id] = { title: entry.title, paragraphs };
        } catch (err) {
          console.error(`[/translate/book] section "${entry.id}" failed:`, err.message);
          sections[entry.id] = { title: entry.title, paragraphs: [] };
        }

        done++;
        send({
          type: 'progress',
          phase: 'section',
          current: done,
          total: toc.length,
          sectionId: entry.id,
          title: entry.title,
        });
      }));
    }

    // ── Phase 4: Assemble final book ────────────────────────────────────────
    const bookId = computeBookId(bookTitle, toc.map(t => t.id));
    const book = {
      version: 2,
      id: bookId,
      title: bookTitle,
      author: bookAuthor,
      description: description || null,
      genre: genre || null,
      difficulty,
      language,
      toc: toc.map(t => ({ id: t.id, title: t.title, href: t.id, level: t.level })),
      spineHrefs: toc.map(t => t.id),
      chapterContent: Object.fromEntries(
        toc.map(t => [t.id, sections[t.id] || { title: t.title, paragraphs: [] }])
      ),
      savedAt: Date.now(),
    };

    send({ type: 'book', data: book });
    res.end();
  } catch (err) {
    console.error('[/translate/book] error:', err);
    try {
      send({ type: 'error', message: err.message || 'Book parsing failed' });
    } catch {}
    res.end();
  }
});

module.exports = router;
