import { useRef, useCallback } from 'react';
import { Platform } from 'react-native';
import Sound from 'react-native-sound';
import RNFS from 'react-native-fs';
import { speak } from '../api/client';

// Enable playback in silence mode on iOS
Sound.setCategory('Playback');

export function useAudio() {
  const cacheRef = useRef<Record<string, Promise<string>>>({});
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const soundRef = useRef<Sound | null>(null);

  const prefetchAudio = useCallback((word: string) => {
    if (!cacheRef.current[word]) {
      cacheRef.current[word] = speak(word);
    }
    return cacheRef.current[word];
  }, []);

  const playAudio = useCallback(
    async (word: string) => {
      try {
        const base64 = await prefetchAudio(word);

        if (Platform.OS === 'web') {
          // Stop any currently playing audio
          if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current = null;
          }

          const audio = new Audio(`data:audio/mp3;base64,${base64}`);
          audioRef.current = audio;
          await audio.play();
        } else {
          // Stop any currently playing sound
          if (soundRef.current) {
            soundRef.current.stop();
            soundRef.current.release();
            soundRef.current = null;
          }

          // Write base64 to temp file and play
          const tempPath = `${RNFS.CachesDirectoryPath}/audio_${word}.mp3`;
          await RNFS.writeFile(tempPath, base64, 'base64');

          const sound = new Sound(tempPath, '', (error) => {
            if (error) {
              console.error('Failed to load sound:', error);
              return;
            }
            soundRef.current = sound;
            sound.play((success) => {
              if (!success) {
                console.error('Sound playback failed');
              }
              sound.release();
            });
          });
        }
      } catch (err) {
        console.error('Audio playback failed:', err);
      }
    },
    [prefetchAudio]
  );

  return { playAudio, prefetchAudio };
}
