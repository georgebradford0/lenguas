import RNFS from 'react-native-fs';
import type { SerializedBook } from './epubParser';
import type { LibrarySummary } from '../api/client';

const STORAGE_DIR = `${RNFS.DocumentDirectoryPath}/readalong`;

export interface BookPosition {
  chapterIdx: number;
  sentenceIdx: number;
}

export interface ReadAlongState {
  currentBookHash: string | null;
  // string → BookPosition (new) or number (legacy: chapter index, sentence 0).
  // normalizePosition handles both transparently.
  positions: Record<string, BookPosition | number>;
}

function normalizePosition(raw: BookPosition | number | undefined): BookPosition {
  if (typeof raw === 'number') return { chapterIdx: raw, sentenceIdx: 0 };
  if (raw && typeof raw === 'object' && typeof raw.chapterIdx === 'number') {
    return {
      chapterIdx: raw.chapterIdx,
      sentenceIdx: typeof raw.sentenceIdx === 'number' ? raw.sentenceIdx : 0,
    };
  }
  return { chapterIdx: 0, sentenceIdx: 0 };
}

async function ensureDir() {
  const exists = await RNFS.exists(STORAGE_DIR);
  if (!exists) await RNFS.mkdir(STORAGE_DIR);
}

const bookPath = (hash: string) => `${STORAGE_DIR}/book_${hash}.json`;
const libraryCachePath = (lang: string) => `${STORAGE_DIR}/library_${lang}.json`;
const allLibraryCachePath = `${STORAGE_DIR}/library_all.json`;
const statePath = (lang: string) => `${STORAGE_DIR}/state_${lang}.json`;
const lastBookPath = `${STORAGE_DIR}/last_book.json`;

async function readJson<T>(path: string): Promise<T | null> {
  try {
    const exists = await RNFS.exists(path);
    if (!exists) return null;
    const raw = await RNFS.readFile(path, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await ensureDir();
  await RNFS.writeFile(path, JSON.stringify(data), 'utf8');
}

// ── Full book cache (downloaded SerializedBook keyed by content hash) ────────

export async function cacheBook(contentHash: string, book: SerializedBook): Promise<void> {
  await writeJson(bookPath(contentHash), book);
}

export async function loadCachedBook(contentHash: string): Promise<SerializedBook | null> {
  return readJson<SerializedBook>(bookPath(contentHash));
}

export async function hasCachedBook(contentHash: string): Promise<boolean> {
  return RNFS.exists(bookPath(contentHash));
}

export async function deleteCachedBook(contentHash: string): Promise<void> {
  try {
    if (await RNFS.exists(bookPath(contentHash))) await RNFS.unlink(bookPath(contentHash));
  } catch {}
}

// ── Library list cache (latest server response, used as offline fallback) ────

export async function cacheLibraryList(language: string, books: LibrarySummary[]): Promise<void> {
  await writeJson(libraryCachePath(language), books);
}

export async function loadCachedLibraryList(language: string): Promise<LibrarySummary[] | null> {
  return readJson<LibrarySummary[]>(libraryCachePath(language));
}

// Whole-library cache (all languages) for the unified library screen.
export async function cacheAllLibrary(books: LibrarySummary[]): Promise<void> {
  await writeJson(allLibraryCachePath, books);
}

export async function loadCachedAllLibrary(): Promise<LibrarySummary[] | null> {
  return readJson<LibrarySummary[]>(allLibraryCachePath);
}

// ── Last-opened book (global across languages) ───────────────────────────────
// App boot reads this and, if set, jumps straight into the reader for that
// book. Cleared when the user explicitly taps back to the library.

export async function setLastOpenedBook(book: LibrarySummary | null): Promise<void> {
  if (book === null) {
    try {
      if (await RNFS.exists(lastBookPath)) await RNFS.unlink(lastBookPath);
    } catch {}
    return;
  }
  await writeJson(lastBookPath, { book });
}

export async function getLastOpenedBook(): Promise<LibrarySummary | null> {
  const stored = await readJson<{ book: LibrarySummary }>(lastBookPath);
  return stored?.book ?? null;
}

// ── Per-language reading state ───────────────────────────────────────────────

export async function getState(language: string): Promise<ReadAlongState> {
  const s = await readJson<ReadAlongState>(statePath(language));
  return s ?? { currentBookHash: null, positions: {} };
}

export async function setCurrentBookHash(language: string, hash: string | null): Promise<void> {
  const state = await getState(language);
  state.currentBookHash = hash;
  await writeJson(statePath(language), state);
}

export async function setPosition(
  language: string,
  contentHash: string,
  position: BookPosition,
): Promise<void> {
  const state = await getState(language);
  state.positions[contentHash] = position;
  await writeJson(statePath(language), state);
}

export async function getPosition(
  language: string,
  contentHash: string,
): Promise<BookPosition> {
  const state = await getState(language);
  return normalizePosition(state.positions[contentHash]);
}
