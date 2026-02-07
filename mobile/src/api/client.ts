import type {
  TranslationResult,
  ProgressRecord,
  WordData,
  GenerateTaskResponse,
  SubmitAnswerRequest,
  SubmitAnswerResponse,
  TierStatsResponse,
  TaskType,
} from '../types';

// For iOS Simulator: Simulators can access localhost
// For Docker: Make sure container exposes port with -p 3000:3000
const API_BASE = 'http://localhost:3000';

export async function loadWords(): Promise<WordData[]> {
  const response = await fetch(`${API_BASE}/words`);
  if (!response.ok) {
    throw new Error('Failed to load words');
  }
  return response.json();
}

export async function translate(word: string): Promise<TranslationResult> {
  const response = await fetch(`${API_BASE}/translate/${encodeURIComponent(word)}`);
  if (!response.ok) {
    throw new Error('Failed to translate word');
  }
  return response.json();
}

export async function speak(text: string): Promise<string> {
  const response = await fetch(`${API_BASE}/speak/${encodeURIComponent(text)}`);
  if (!response.ok) {
    throw new Error('Failed to get speech');
  }
  const arrayBuffer = await response.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function loadProgress(): Promise<Record<string, ProgressRecord>> {
  const response = await fetch(`${API_BASE}/progress`);
  if (!response.ok) {
    throw new Error('Failed to load progress');
  }
  const records: ProgressRecord[] = await response.json();
  const progress: Record<string, ProgressRecord> = {};
  for (const r of records) {
    progress[r.word] = {
      word: r.word,
      timesShown: r.timesShown,
      correctCount: r.correctCount,
      tier: r.tier,
      lastSeenTaskType: r.lastSeenTaskType,
    };
  }
  return progress;
}

export async function saveProgress(
  word: string,
  data: { timesShown: number; correctCount: number; tier?: number; lastSeenTaskType?: string }
): Promise<void> {
  await fetch(`${API_BASE}/progress/${encodeURIComponent(word)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
}

// New LLM-based task generation API

export async function generateTask(
  tier: number,
  taskType: TaskType,
  focusArea?: string
): Promise<GenerateTaskResponse> {
  const response = await fetch(`${API_BASE}/generate-task`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      tier,
      taskType,
      focusArea: focusArea || 'general',
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to generate task');
  }

  return response.json();
}

export async function submitAnswer(
  request: SubmitAnswerRequest
): Promise<SubmitAnswerResponse> {
  const response = await fetch(`${API_BASE}/submit-answer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error('Failed to submit answer');
  }

  return response.json();
}

export async function getTierStats(): Promise<TierStatsResponse> {
  const response = await fetch(`${API_BASE}/tier-stats`);

  if (!response.ok) {
    throw new Error('Failed to load tier stats');
  }

  return response.json();
}
