import { useRef, useCallback, useEffect } from 'react';
import { Platform } from 'react-native';
import { createSound } from 'react-native-nitro-sound';
import type { Sound } from 'react-native-nitro-sound';
import RNFS from 'react-native-fs';
import { speak } from '../api/client';

export function useAudio(language = 'de') {
  const cacheRef = useRef<Record<string, Promise<string>>>({});
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const soundRef = useRef<Sound | null>(null);

  // Delete any leftover audio files from previous sessions on startup
  useEffect(() => {
    if (Platform.OS !== 'web') {
      RNFS.readDir(RNFS.CachesDirectoryPath)
        .then(items =>
          items
            .filter(item => item.name.startsWith('audio_'))
            .forEach(item => RNFS.unlink(item.path).catch(() => {}))
        )
        .catch(() => {});
    }
  }, []);

  const prefetchAudio = useCallback((word: string) => {
    const key = `${language}:${word}`;
    if (!cacheRef.current[key]) {
      cacheRef.current[key] = speak(word, language);
    }
    return cacheRef.current[key];
  }, [language]);

  const clearAudio = useCallback((word: string) => {
    const key = `${language}:${word}`;
    delete cacheRef.current[key];
    if (Platform.OS !== 'web') {
      const sanitizedWord = word.replace(/[^a-zA-Z0-9]/g, '_');
      const tempPath = `${RNFS.CachesDirectoryPath}/audio_${language}_${sanitizedWord}.mp3`;
      RNFS.unlink(tempPath).catch(() => {});
    }
  }, [language]);

  const playAudio = useCallback(
    async (word: string): Promise<void> => {
      try {
        const base64 = await prefetchAudio(word);

        if (Platform.OS === 'web') {
          if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current = null;
          }

          const audio = new Audio(`data:audio/mp3;base64,${base64}`);
          audioRef.current = audio;

          await new Promise<void>((resolve, reject) => {
            audio.onended = () => resolve();
            audio.onerror = (err) => reject(err);
            audio.play().catch(reject);
          });

          audioRef.current = null;
        } else {
          if (soundRef.current) {
            try {
              await soundRef.current.stopPlayer();
            } catch {}
            soundRef.current = null;
          }

          const sanitizedWord = word.replace(/[^a-zA-Z0-9]/g, '_');
          const tempPath = `${RNFS.CachesDirectoryPath}/audio_${language}_${sanitizedWord}.mp3`;

          if (!base64 || base64.length === 0) {
            console.error('Empty base64 audio data for word:', word);
            return;
          }

          try {
            await RNFS.writeFile(tempPath, base64, 'base64');
          } catch (writeError) {
            console.error('Failed to write audio file:', writeError);
            return;
          }

          const sound = createSound();
          soundRef.current = sound;

          await new Promise<void>((resolve, reject) => {
            sound.addPlaybackEndListener(() => {
              sound.removePlaybackEndListener();
              soundRef.current = null;
              resolve();
            });
            sound.startPlayer(tempPath).catch((err) => {
              sound.removePlaybackEndListener();
              soundRef.current = null;
              reject(err);
            });
          });
        }
      } catch (err) {
        console.error('Audio playback failed:', err);
      }
    },
    [prefetchAudio, language]
  );

  return { playAudio, prefetchAudio, clearAudio };
}
