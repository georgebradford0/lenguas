import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { Card, Choice } from '../types';
import { shuffle } from '../utils/shuffle';
import { useAudio } from '../hooks/useAudio';
import { useTranslation } from '../hooks/useTranslation';
import { WordCard } from './WordCard';
import { ChoiceGrid } from './ChoiceGrid';

interface MultipleChoiceTaskProps {
  card: Card;
  onAnswer: (correct: boolean) => void;
  onCardReady?: () => void;
}

const ADVANCE_DELAY = 1200;

export function MultipleChoiceTask({ card, onAnswer, onCardReady }: MultipleChoiceTaskProps) {
  const { playAudio, prefetchAudio } = useAudio();
  const { getTranslation, prefetchTranslation } = useTranslation();

  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [answered, setAnswered] = useState(false);
  const [displayedWord, setDisplayedWord] = useState<string | null>(null);
  const loadedWordRef = useRef<string | null>(null);

  // Load choices when card changes
  useEffect(() => {
    if (!card) {
      setChoices(null);
      setDisplayedWord(null);
      loadedWordRef.current = null;
      return;
    }

    // Skip if we already loaded this word
    if (loadedWordRef.current === card.word) {
      return;
    }

    // Prefetch audio
    prefetchAudio(card.word);

    // Load translation, then update UI all at once to avoid flicker
    getTranslation(card.word)
      .then((result) => {
        const options = shuffle([
          { text: result.translation, correct: true },
          { text: result.wrong[0], correct: false },
          { text: result.wrong[1], correct: false },
          { text: result.wrong[2], correct: false },
        ]);

        // Update all state together to avoid flicker
        setChoices(options);
        setSelectedIndex(null);
        setAnswered(false);
        setDisplayedWord(card.word);
        loadedWordRef.current = card.word;

        // Auto-play audio after card is fully loaded
        playAudio(card.word);

        // Notify parent that card is ready
        onCardReady?.();
      })
      .catch((err) => {
        console.error('Failed to load translation:', err);
      });
  }, [card, prefetchAudio, playAudio, getTranslation, onCardReady]);

  const handleSelect = useCallback(
    (index: number) => {
      if (answered || !choices) return;

      setSelectedIndex(index);
      setAnswered(true);

      const correct = choices[index].correct;

      // Auto-advance after delay
      setTimeout(() => {
        loadedWordRef.current = null; // Allow loading next card
        onAnswer(correct);
      }, ADVANCE_DELAY);
    },
    [answered, choices, onAnswer]
  );

  const handleSpeak = useCallback(() => {
    if (displayedWord) {
      playAudio(displayedWord);
    }
  }, [displayedWord, playAudio]);

  return (
    <>
      <WordCard word={displayedWord || card.word} onSpeak={handleSpeak} />
      <ChoiceGrid
        choices={choices}
        selectedIndex={selectedIndex}
        answered={answered}
        onSelect={handleSelect}
      />
    </>
  );
}
