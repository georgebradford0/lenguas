// Types + hydrate logic for parsed books.
//
// The actual EPUB-to-reader-format conversion runs on the server now
// (POST /translate/book). What's left here is:
//   - the runtime shape used by the reader (Sentence, Word, Paragraph, etc.)
//   - hydrateSerializedBook: turns the stored book back into renderable form
//   - cleanWord: edge-punctuation stripping for word taps

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TocEntry {
  id: string;
  title: string;
  href: string;    // = id (kept for backward compat with the rendering code)
  anchor?: string;
  level: number;
}

export interface Word {
  id: string;
  text: string;
  isWord: boolean;
}

export interface Sentence {
  id: string;
  words: Word[];
  raw: string;
}

export interface Paragraph {
  id: string;
  sentences: Sentence[];
}

export interface Chapter {
  id: string;
  title: string;
  paragraphs: Paragraph[];
}

export interface EpubHandle {
  id: string;
  title: string;
  language: string;
  toc: TocEntry[];
  spineHrefs: string[];
  chapters: Record<string, Chapter>; // keyed by href (= id)
}

export interface SerializedBook {
  version?: number;
  id: string;
  title: string;
  language: string;
  toc: TocEntry[];
  spineHrefs: string[];
  chapterContent: Record<string, { title: string; paragraphs: string[][] }>;
  savedAt: number;
}

// ── Hydrate ───────────────────────────────────────────────────────────────────

/** Rebuild an EpubHandle from a SerializedBook so the reader can render it. */
export function hydrateSerializedBook(stored: SerializedBook): EpubHandle {
  const chapters: Record<string, Chapter> = {};
  stored.spineHrefs.forEach((href, idx) => {
    const ch = stored.chapterContent[href];
    if (!ch) return;
    chapters[href] = {
      id: `ch${idx}`,
      title: ch.title,
      paragraphs: buildParagraphsFromStructured(ch.paragraphs, idx),
    };
  });
  return {
    id: stored.id,
    title: stored.title,
    language: stored.language,
    toc: stored.toc,
    spineHrefs: stored.spineHrefs,
    chapters,
  };
}

function buildParagraphsFromStructured(structured: string[][], chapterIdx: number): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  for (let pIdx = 0; pIdx < structured.length; pIdx++) {
    const pid = `${chapterIdx}_p${pIdx}`;
    const sentences: Sentence[] = structured[pIdx].map((s, sIdx) => ({
      id: `${pid}_s${sIdx}`,
      words: tokenize(s, `${pid}_s${sIdx}`),
      raw: s,
    }));
    if (sentences.length > 0) paragraphs.push({ id: pid, sentences });
  }
  return paragraphs;
}

function tokenize(sentence: string, prefix: string): Word[] {
  const parts = sentence.split(/(\s+)/);
  return parts
    .filter(p => p.length > 0)
    .map((text, i) => ({
      id: `${prefix}_w${i}`,
      text,
      isWord: !/^\s+$/.test(text),
    }));
}

/** Strip punctuation from word edges so we send clean text to translation. */
export function cleanWord(text: string): string {
  return text.replace(/^[^a-zA-ZÀ-ɏЀ-ӿ]+|[^a-zA-ZÀ-ɏЀ-ӿ]+$/g, '').trim();
}
