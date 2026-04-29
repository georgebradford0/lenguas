import JSZip from 'jszip';
import RNFS from 'react-native-fs';
import { XMLParser } from 'fast-xml-parser';
import { parseDocument, DomUtils, ElementType } from 'htmlparser2';
import he from 'he';
import { parseChapterText } from '../api/client';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TocEntry {
  id: string;
  title: string;
  href: string;    // full path within zip (e.g. "OEBPS/chapter01.xhtml")
  anchor?: string; // #fragment within the file
  level: number;
}

export interface Word {
  id: string;
  text: string;
  isWord: boolean; // false for whitespace tokens
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
  title: string;
  language: string;
  toc: TocEntry[];
  spineHrefs: string[]; // chapter files in reading order
  zip: JSZip;
  chapters: Record<string, Chapter>; // href → pre-parsed chapter
}

// ── XML parser ────────────────────────────────────────────────────────────────

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  isArray: (name) => ['item', 'itemref', 'navPoint', 'li', 'a'].includes(name),
  processEntities: true,
});

// ── Path resolution ───────────────────────────────────────────────────────────

/** Resolve a relative href against a base directory path, collapsing `..` segments. */
function resolveEpubPath(base: string, relative: string): string {
  if (!relative) return base;
  if (relative.startsWith('/')) return relative.replace(/^\/+/, '');
  const dir = base.endsWith('/') ? base : base.slice(0, base.lastIndexOf('/') + 1);
  const parts = (dir + relative).split('/');
  const resolved: string[] = [];
  for (const p of parts) {
    if (p === '..') resolved.pop();
    else if (p !== '.') resolved.push(p);
  }
  return resolved.join('/');
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function parseEpub(
  localUri: string,
  onProgress?: (done: number, total: number) => void,
): Promise<EpubHandle> {
  const filePath = decodeURIComponent(localUri.replace(/^file:\/\//, ''));
  const base64 = await RNFS.readFile(filePath, 'base64');
  const zip = await JSZip.loadAsync(base64, { base64: true });

  // 1. container.xml → OPF path
  const containerXml = await zip.file('META-INF/container.xml')?.async('string');
  if (!containerXml) throw new Error('Not a valid epub: missing container.xml');

  const container = xmlParser.parse(containerXml);
  const rootfiles = container?.container?.rootfiles?.rootfile;
  const rootfile = Array.isArray(rootfiles) ? rootfiles[0] : rootfiles;
  const opfPath: string = rootfile?.['@_full-path'];
  if (!opfPath) throw new Error('Cannot find OPF path');

  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';

  // 2. Parse OPF
  const opfXml = await zip.file(opfPath)?.async('string');
  if (!opfXml) throw new Error('Cannot read OPF file');
  const opf = xmlParser.parse(opfXml);
  const pkg = opf?.package;

  const metadata = pkg?.metadata ?? {};
  const rawTitle = metadata?.['dc:title'];
  const title = String(
    (typeof rawTitle === 'object' ? rawTitle?.['#text'] : rawTitle) ?? 'Unknown Title'
  );

  const rawLang = metadata?.['dc:language'];
  const language = String(
    (typeof rawLang === 'object' ? rawLang?.['#text'] : rawLang) ?? 'de'
  );

  // Manifest: id → { href, mediaType, properties }
  const manifestRaw = pkg?.manifest?.item ?? [];
  const manifestItems = Array.isArray(manifestRaw) ? manifestRaw : [manifestRaw];
  const manifest: Record<string, { href: string; mediaType: string; properties?: string }> = {};
  for (const item of manifestItems) {
    const id = item['@_id'];
    if (id) {
      manifest[id] = {
        href: item['@_href'] ?? '',
        mediaType: item['@_media-type'] ?? '',
        properties: item['@_properties'],
      };
    }
  }

  // Spine → reading order hrefs
  const spineRaw = pkg?.spine?.itemref ?? [];
  const spineItems = Array.isArray(spineRaw) ? spineRaw : [spineRaw];
  const spineHrefs = spineItems
    .map((ref: any) => {
      const href = manifest[ref['@_idref']]?.href;
      return href ? resolveEpubPath(opfDir, href) : null;
    })
    .filter((h): h is string => !!h);

  // 3. TOC — epub3 nav first, epub2 NCX fallback
  let toc: TocEntry[] = [];

  const navEntry = Object.values(manifest).find(m => m.properties?.includes('nav'));
  if (navEntry) {
    const navXml = await zip.file(resolveEpubPath(opfDir, navEntry.href))?.async('string');
    if (navXml) toc = parseNavXhtml(navXml, opfDir);
  }

  if (toc.length === 0) {
    const ncxId = pkg?.spine?.['@_toc'];
    const ncxHref = ncxId
      ? manifest[ncxId]?.href
      : Object.values(manifest).find(m => m.mediaType === 'application/x-dtbncx+xml')?.href;
    if (ncxHref) {
      const ncxXml = await zip.file(resolveEpubPath(opfDir, ncxHref))?.async('string');
      if (ncxXml) toc = parseNcx(ncxXml, opfDir);
    }
  }

  // Fallback: one entry per spine chapter
  if (toc.length === 0) {
    toc = spineHrefs.map((href, i) => ({
      id: `ch${i}`,
      title: `Chapter ${i + 1}`,
      href,
      level: 0,
    }));
  }

  // Build a title lookup from TOC (first matching entry wins)
  const hrefToTitle: Record<string, string> = {};
  for (const entry of toc) {
    if (!hrefToTitle[entry.href]) hrefToTitle[entry.href] = entry.title;
  }

  // Pre-parse all chapters in batches of 5 (parallel within each batch)
  const BATCH_SIZE = 5;
  const chapters: Record<string, Chapter> = {};
  let done = 0;

  for (let i = 0; i < spineHrefs.length; i += BATCH_SIZE) {
    const batch = spineHrefs.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (href, offset) => {
        const chapterIdx = i + offset;
        const file = zip.file(href);
        if (!file) return;
        const xhtml = await file.async('string');
        const rawLines = extractRawLines(xhtml);
        let paragraphs: Paragraph[];
        try {
          const structured = await parseChapterText(rawLines, language);
          paragraphs = buildParagraphsFromStructured(structured, chapterIdx);
        } catch {
          paragraphs = buildParagraphsFromLines(rawLines, chapterIdx);
        }
        const chapterTitle = hrefToTitle[href] ?? `Chapter ${chapterIdx + 1}`;
        chapters[href] = { id: `ch${chapterIdx}`, title: chapterTitle, paragraphs };
        done++;
        onProgress?.(done, spineHrefs.length);
      }),
    );
  }

  return { title, language, toc, spineHrefs, zip, chapters };
}

/** Parse a single chapter's XHTML and return a Chapter ready for rendering. */
export async function loadChapter(
  zip: JSZip,
  href: string,
  chapterIdx: number,
  title: string,
  language = 'de',
): Promise<Chapter> {
  const file = zip.file(href);
  if (!file) throw new Error(`Chapter file not found: ${href}`);
  const xhtml = await file.async('string');

  const rawLines = extractRawLines(xhtml);

  let paragraphs: Paragraph[];
  try {
    const structured = await parseChapterText(rawLines, language);
    paragraphs = buildParagraphsFromStructured(structured, chapterIdx);
  } catch {
    paragraphs = buildParagraphsFromLines(rawLines, chapterIdx);
  }

  return { id: `ch${chapterIdx}`, title, paragraphs };
}

/** Strip punctuation from word edges so we send clean text to translation. */
export function cleanWord(text: string): string {
  return text.replace(/^[^a-zA-ZÀ-ɏЀ-ӿ]+|[^a-zA-ZÀ-ɏЀ-ӿ]+$/g, '').trim();
}

// ── TOC parsers ───────────────────────────────────────────────────────────────

function parseNavXhtml(navXml: string, opfDir: string): TocEntry[] {
  const entries: TocEntry[] = [];
  const doc = parseDocument(navXml, { xmlMode: false });

  const navElements = DomUtils.findAll(
    (el: any) => el.type === ElementType.Tag && el.name === 'nav',
    doc.children as any[],
  );

  const tocNav = navElements.find((el: any) => {
    const epubType: string = el.attribs?.['epub:type'] ?? '';
    return epubType.split(/\s+/).includes('toc');
  });

  if (!tocNav) return entries;

  function walkList(nodes: any[], level: number) {
    for (const node of nodes) {
      if (node.type !== ElementType.Tag) continue;
      if (node.name === 'li') {
        const anchor = DomUtils.findOne(
          (n: any) => n.type === ElementType.Tag && n.name === 'a',
          node.children,
        ) as any;
        if (anchor) {
          const rawHref: string = anchor.attribs?.href ?? '';
          const [hrefRel, fragment] = rawHref.split('#');
          const linkText = he.decode(DomUtils.getText(anchor)).trim();
          if (linkText && hrefRel) {
            entries.push({
              id: `toc${entries.length}`,
              title: linkText,
              href: resolveEpubPath(opfDir, hrefRel),
              anchor: fragment || undefined,
              level,
            });
          }
        }
        const subList = DomUtils.findOne(
          (n: any) => n.type === ElementType.Tag && (n.name === 'ol' || n.name === 'ul'),
          node.children,
        ) as any;
        if (subList) walkList(subList.children, level + 1);
      } else if (node.name === 'ol' || node.name === 'ul') {
        walkList(node.children, level);
      }
    }
  }

  walkList((tocNav as any).children, 0);
  return entries;
}

function parseNcx(ncxXml: string, opfDir: string): TocEntry[] {
  const ncx = xmlParser.parse(ncxXml);
  const navPoints: any[] = ncx?.ncx?.navMap?.navPoint ?? [];
  const entries: TocEntry[] = [];

  function walk(points: any[], level: number) {
    const arr = Array.isArray(points) ? points : [points];
    for (const pt of arr) {
      const labelText = pt?.navLabel?.text;
      const text = String(typeof labelText === 'object' ? labelText?.['#text'] : labelText ?? '').trim();
      const src = String(pt?.content?.['@_src'] ?? '');
      const [hrefRel, anchor] = src.split('#');
      if (text && hrefRel) {
        entries.push({
          id: pt['@_id'] ?? `ncx${entries.length}`,
          title: text,
          href: resolveEpubPath(opfDir, hrefRel),
          anchor: anchor || undefined,
          level,
        });
      }
      if (pt.navPoint) walk(pt.navPoint, level + 1);
    }
  }

  walk(navPoints, 0);
  return entries;
}

// ── Chapter content extraction ────────────────────────────────────────────────

// epub:type values whose subtrees should be omitted from extracted text
const SKIP_EPUB_TYPES = new Set([
  'footnote', 'endnote', 'footnotes', 'endnotes',
  'noteref', 'aside', 'annotation', 'glossary',
]);

// Tags that introduce a paragraph boundary
const BLOCK_TAGS = new Set([
  'p', 'div', 'li', 'dd', 'dt', 'td', 'th',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'section', 'article', 'figcaption', 'caption',
]);

function shouldSkipElement(el: any): boolean {
  const epubType: string = el.attribs?.['epub:type'] ?? '';
  return epubType.split(/\s+/).some((t: string) => SKIP_EPUB_TYPES.has(t));
}

function collectText(node: any, parts: string[]) {
  if (node.type === ElementType.Text) {
    parts.push(node.data as string);
    return;
  }
  if (node.type !== ElementType.Tag) return;
  if (shouldSkipElement(node)) return;
  if (node.name === 'script' || node.name === 'style') return;
  if (node.name === 'br') { parts.push('\n'); return; }

  const isBlock = BLOCK_TAGS.has(node.name as string);
  if (isBlock) parts.push('\n');
  for (const child of node.children ?? []) collectText(child, parts);
  if (isBlock) parts.push('\n');
}

/** Extract raw text lines from XHTML, one per block element. */
function extractRawLines(xhtml: string): string[] {
  const doc = parseDocument(xhtml, { xmlMode: false });

  const body = DomUtils.findOne(
    (el: any) => el.type === ElementType.Tag && el.name === 'body',
    doc.children as any[],
  ) as any;

  const root = body ?? doc;
  const parts: string[] = [];
  for (const child of root.children ?? []) collectText(child, parts);

  const raw = he.decode(parts.join(''));

  return raw
    .split('\n')
    .map((l: string) => l.replace(/\s+/g, ' ').trim())
    .filter((l: string) => l.length > 0);
}

/** Convert OpenAI-structured paragraphs into the Paragraph type. */
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

/** Fallback: build paragraphs from raw lines using regex sentence splitting. */
function buildParagraphsFromLines(lines: string[], chapterIdx: number): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  for (let pIdx = 0; pIdx < lines.length; pIdx++) {
    const pid = `${chapterIdx}_p${pIdx}`;
    const sents = splitSentences(lines[pIdx]);
    const sentences: Sentence[] = sents.map((s, sIdx) => ({
      id: `${pid}_s${sIdx}`,
      words: tokenize(s, `${pid}_s${sIdx}`),
      raw: s,
    }));
    if (sentences.length > 0) paragraphs.push({ id: pid, sentences });
  }
  return paragraphs;
}

// ── Sentence splitting ────────────────────────────────────────────────────────

// Known German and general abbreviations — don't split sentences after these
const ABBREV_RE = /\b(Dr|Prof|Hr|Fr|Hrn|Frn|St|ca|bzw|usw|usf|etc|ggf|ggfs|evtl|inkl|exkl|zB|dh|vgl|Abb|Nr|Str|Tel|Fax|Jh|Jt|Mrd|Mio|Abs|Art|Kap|Sek|Min|Std|Jan|Feb|M[äa]r|Apr|Mai|Jun|Jul|Aug|Sep|Okt|Nov|Dez|[a-z])\.\s*$/;

function splitSentences(text: string): string[] {
  // Normalize ASCII ellipsis to Unicode so it doesn't cause spurious splits
  const normalized = text.replace(/\.{3}/g, '…');

  const raw = normalized.split(/(?<=[.!?…])\s+/);

  // Merge back any fragment that was split after an abbreviation
  const merged: string[] = [];
  for (const token of raw) {
    if (merged.length > 0 && ABBREV_RE.test(merged[merged.length - 1])) {
      merged[merged.length - 1] += ' ' + token;
    } else {
      merged.push(token);
    }
  }

  return merged.map(s => s.trim()).filter(s => s.length > 0);
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
