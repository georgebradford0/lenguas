// Pure parse pipeline — no HTTP, no S3. Takes raw EPUB bytes and emits
// progress through a callback. The route handler in routes/books.js
// is what binds it to a job entry and durable storage.

const OpenAI = require('openai');
const JSZip = require('jszip');
const { parseDocument, DomUtils, ElementType } = require('htmlparser2');
const he = require('he');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 5 });

const LANGUAGE_NAMES = { de: 'German', nl: 'Dutch', fr: 'French', es: 'Spanish' };

// ── EPUB text extraction ─────────────────────────────────────────────────────

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
      console.warn(`[parseEpub] failed to read ${name}:`, e.message);
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

// ── Full parse pipeline ──────────────────────────────────────────────────────
// Returns the assembled SerializedBook. Calls onProgress(event) along the way
// where event = { phase, message?, current?, total?, toc?, ... }. Throws on
// unrecoverable errors.

async function parseEpub(epubBuffer, language, providedTitle, onProgress = () => {}) {
  if (!LANGUAGE_NAMES[language]) {
    throw new Error(`Invalid language. Must be one of: ${Object.keys(LANGUAGE_NAMES).join(', ')}.`);
  }
  const fromLanguage = LANGUAGE_NAMES[language];

  // Phase 1: extract text
  onProgress({ phase: 'extract', message: 'Reading EPUB...' });
  const { title: extractedTitle, author: extractedAuthor, fullText } = await extractEpubText(epubBuffer);
  const hintTitle = extractedTitle || (providedTitle && providedTitle.trim()) || 'Untitled';
  const hintAuthor = extractedAuthor || null;

  if (!fullText || fullText.length < 200) {
    throw new Error('No readable text found in EPUB');
  }
  console.log(`[parseEpub] hint title "${hintTitle}" — ${fullText.length} chars extracted`);

  // Constant prefix — cached by OpenAI from call 2 onward, so every section
  // call hits the warm [system + bookMessage] prefix regardless of concurrency.
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

  // Phase 2: clean title + TOC + metadata
  onProgress({ phase: 'toc', message: 'Identifying chapters...' });

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
  console.log(`[parseEpub] resolved title "${bookTitle}"${bookAuthor ? ` by ${bookAuthor}` : ''}${difficulty ? ` [${difficulty}]` : ''}, TOC: ${toc.length} entries`);
  onProgress({ phase: 'toc-done', toc, total: toc.length });

  // Phase 3: reproduce sections in parallel batches
  // BATCH_SIZE=15 is tuned for OpenAI Tier 3 on gpt-4.1-mini.
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
        console.error(`[parseEpub] section "${entry.id}" failed:`, err.message);
        sections[entry.id] = { title: entry.title, paragraphs: [] };
      }

      done++;
      onProgress({
        phase: 'section',
        current: done,
        total: toc.length,
        sectionId: entry.id,
        title: entry.title,
      });
    }));
  }

  // Phase 4: assemble
  const bookId = computeBookId(bookTitle, toc.map(t => t.id));
  return {
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
}

module.exports = { parseEpub, LANGUAGE_NAMES };
