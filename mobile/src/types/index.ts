export interface Card {
  word: string;
  timesShown: number;
  correctCount: number;
}

export interface TranslationResult {
  word: string;
  translation: string;
  wrong: string[];
}

export interface ProgressRecord {
  word: string;
  timesShown: number;
  correctCount: number;
}

export interface Choice {
  text: string;
  correct: boolean;
}

export type ChoiceState = 'default' | 'correct' | 'wrong' | 'reveal' | 'disabled';
