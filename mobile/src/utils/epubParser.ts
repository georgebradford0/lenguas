import JSZip from 'jszip';
import RNFS from 'react-native-fs';
import { XMLParser } from 'fast-xml-parser';

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
}

// ── XML parser ────────────────────────────────────────────────────────────────

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  isArray: (name) => ['item', 'itemref', 'navPoint', 'li', 'a'].includes(name),
  processEntities: true,
});

// ── Public API ────────────────────────────────────────────────────────────────

export async function parseEpub(localUri: string): Promise<EpubHandle> {
  const filePath = localUri.replace(/^file:\/\//, '');
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
      return href ? opfDir + href : null;
    })
    .filter((h): h is string => !!h);

  // 3. TOC — epub3 nav first, epub2 NCX fallback
  let toc: TocEntry[] = [];

  const navEntry = Object.values(manifest).find(m => m.properties?.includes('nav'));
  if (navEntry) {
    const navXml = await zip.file(opfDir + navEntry.href)?.async('string');
    if (navXml) toc = parseNavXhtml(navXml, opfDir);
  }

  if (toc.length === 0) {
    const ncxId = pkg?.spine?.['@_toc'];
    const ncxHref = ncxId
      ? manifest[ncxId]?.href
      : Object.values(manifest).find(m => m.mediaType === 'application/x-dtbncx+xml')?.href;
    if (ncxHref) {
      const ncxXml = await zip.file(opfDir + ncxHref)?.async('string');
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

  return { title, language, toc, spineHrefs, zip };
}

/** Parse a single chapter's XHTML and return a Chapter ready for rendering. */
export async function loadChapter(
  zip: JSZip,
  href: string,
  chapterIdx: number,
  title: string,
): Promise<Chapter> {
  const file = zip.file(href);
  if (!file) throw new Error(`Chapter file not found: ${href}`);
  const xhtml = await file.async('string');
  const paragraphs = extractParagraphs(xhtml, chapterIdx);
  return { id: `ch${chapterIdx}`, title, paragraphs };
}

/** Strip punctuation from word edges so we send clean text to translation. */
export function cleanWord(text: string): string {
  return text.replace(/^[^a-zA-Z\u00C0-\u024F\u0400-\u04FF]+|[^a-zA-Z\u00C0-\u024F\u0400-\u04FF]+$/g, '').trim();
}

// ── TOC parsers ───────────────────────────────────────────────────────────────

function parseNavXhtml(navXml: string, opfDir: string): TocEntry[] {
  const entries: TocEntry[] = [];
  // Find the toc <nav> element
  const tocNavMatch = navXml.match(/<nav[^>]*epub:type="toc"[^>]*>([\s\S]*?)<\/nav>/);
  if (!tocNavMatch) return entries;

  const aRegex = /<a[^>]*href="([^"#]*)(?:#([^"]*))?"[^>]*>([^<]*)<\/a>/g;
  let match: RegExpExecArray | null;
  let idx = 0;
  while ((match = aRegex.exec(tocNavMatch[1])) !== null) {
    const title = decodeEntities(match[3]).trim();
    if (title) {
      entries.push({
        id: `toc${idx++}`,
        title,
        href: opfDir + match[1],
        anchor: match[2] || undefined,
        level: 0,
      });
    }
  }
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
          href: opfDir + hrefRel,
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

function extractParagraphs(xhtml: string, chapterIdx: number): Paragraph[] {
  // Strip scripts and styles
  let content = xhtml
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  // Convert block elements to newline boundaries
  content = content
    .replace(/<\/(p|div|li|h[1-6]|blockquote|section|article|tr)[^>]*>/gi, '\n')
    .replace(/<(br|hr)[^>]*\/?>/gi, '\n')
    .replace(/<(p|div|li|h[1-6]|blockquote|section|article)[^>]*>/gi, '\n');

  // Strip remaining tags
  content = content.replace(/<[^>]+>/g, '');
  content = decodeEntities(content);

  const lines = content
    .split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(l => l.length > 2);

  const paragraphs: Paragraph[] = [];
  for (let pIdx = 0; pIdx < lines.length; pIdx++) {
    const pid = `${chapterIdx}_p${pIdx}`;
    const sents = splitSentences(lines[pIdx]);
    const sentences: Sentence[] = sents.map((raw, sIdx) => ({
      id: `${pid}_s${sIdx}`,
      words: tokenize(raw, `${pid}_s${sIdx}`),
      raw,
    }));
    if (sentences.length > 0) paragraphs.push({ id: pid, sentences });
  }
  return paragraphs;
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

function tokenize(sentence: string, prefix: string): Word[] {
  // Split on whitespace, keeping whitespace as separate (non-word) tokens
  const parts = sentence.split(/(\s+)/);
  return parts
    .filter(p => p.length > 0)
    .map((text, i) => ({
      id: `${prefix}_w${i}`,
      text,
      isWord: !/^\s+$/.test(text),
    }));
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
