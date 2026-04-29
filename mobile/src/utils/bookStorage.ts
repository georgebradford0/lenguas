import RNFS from 'react-native-fs';
import type { SerializedBook } from './epubParser';

const STORAGE_DIR = `${RNFS.DocumentDirectoryPath}/readalong`;

export interface BookSummary {
  id: string;
  title: string;
  language: string;
  addedAt: number;
}

export interface ReadAlongState {
  currentBookId: string | null;
  positions: Record<string, number>;
}

async function ensureDir() {
  const exists = await RNFS.exists(STORAGE_DIR);
  if (!exists) await RNFS.mkdir(STORAGE_DIR);
}

const bookPath = (id: string) => `${STORAGE_DIR}/book_${id}.json`;
const libraryPath = (lang: string) => `${STORAGE_DIR}/library_${lang}.json`;
const statePath = (lang: string) => `${STORAGE_DIR}/state_${lang}.json`;

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

export async function saveBook(book: SerializedBook): Promise<void> {
  await writeJson(bookPath(book.id), book);
  const lib = (await readJson<BookSummary[]>(libraryPath(book.language))) ?? [];
  const summary: BookSummary = {
    id: book.id,
    title: book.title,
    language: book.language,
    addedAt: book.savedAt,
  };
  const existingIdx = lib.findIndex(b => b.id === book.id);
  if (existingIdx >= 0) lib[existingIdx] = summary;
  else lib.push(summary);
  await writeJson(libraryPath(book.language), lib);
}

export async function loadBook(id: string): Promise<SerializedBook | null> {
  return readJson<SerializedBook>(bookPath(id));
}

export async function listBooks(language: string): Promise<BookSummary[]> {
  const lib = (await readJson<BookSummary[]>(libraryPath(language))) ?? [];
  return [...lib].sort((a, b) => b.addedAt - a.addedAt);
}

export async function deleteBook(id: string, language: string): Promise<void> {
  try {
    const exists = await RNFS.exists(bookPath(id));
    if (exists) await RNFS.unlink(bookPath(id));
  } catch {}
  const lib = (await readJson<BookSummary[]>(libraryPath(language))) ?? [];
  await writeJson(libraryPath(language), lib.filter(b => b.id !== id));
  const state = await getState(language);
  if (state.currentBookId === id) state.currentBookId = null;
  delete state.positions[id];
  await writeJson(statePath(language), state);
}

export async function getState(language: string): Promise<ReadAlongState> {
  const s = await readJson<ReadAlongState>(statePath(language));
  return s ?? { currentBookId: null, positions: {} };
}

export async function setCurrentBook(language: string, id: string | null): Promise<void> {
  const state = await getState(language);
  state.currentBookId = id;
  await writeJson(statePath(language), state);
}

export async function setPosition(
  language: string,
  bookId: string,
  tocIdx: number,
): Promise<void> {
  const state = await getState(language);
  state.positions[bookId] = tocIdx;
  await writeJson(statePath(language), state);
}
