export interface WordData {
  word: string;
  tier: number;
}

export interface Card {
  word: string;
  tier: number;
  timesShown: number;
  correctCount: number;
  taskType?: 'multipleChoice' | 'reverseTranslation';
  lastSeenTaskType?: string | null;
}

export interface TranslationResult {
  word: string;
  translation: string;
  wrong: string[];
}

export interface ProgressRecord {
  word: string;
  tier?: number;
  timesShown: number;
  correctCount: number;
  lastSeenTaskType?: string | null;
}

export interface Choice {
  text: string;
  correct: boolean;
}

export type ChoiceState = 'default' | 'correct' | 'wrong' | 'reveal' | 'disabled';
