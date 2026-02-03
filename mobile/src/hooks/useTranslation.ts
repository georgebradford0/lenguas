import { useRef, useCallback } from 'react';
import type { TranslationResult } from '../types';
import { translate } from '../api/client';

export function useTranslation() {
  const cacheRef = useRef<Record<string, Promise<TranslationResult>>>({});

  const prefetchTranslation = useCallback((word: string) => {
    if (!cacheRef.current[word]) {
      cacheRef.current[word] = translate(word);
    }
    return cacheRef.current[word];
  }, []);

  const getTranslation = useCallback(
    async (word: string): Promise<TranslationResult> => {
      return prefetchTranslation(word);
    },
    [prefetchTranslation]
  );

  return { getTranslation, prefetchTranslation };
}
