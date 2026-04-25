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
  // Per-word generation counter: incremented on each new playAudio call and on clearAudio.
  // Lets a stale in-flight playAudio detect it has been superseded and bail out.
  const playGenRef = useRef<Record<string, number>>({});

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
    playGenRef.current[key] = (playGenRef.current[key] ?? 0) + 1;
    if (Platform.OS !== 'web') {
      const sanitizedWord = word.replace(/[^a-zA-Z0-9]/g, '_');
      const tempPath = `${RNFS.CachesDirectoryPath}/audio_${language}_${sanitizedWord}.mp3`;
      RNFS.unlink(tempPath).catch(() => {});
    }
  }, [language]);

  const playAudio = useCallback(
    async (word: string): Promise<void> => {
      try {
        const key = `${language}:${word}`;
        const myGen = (playGenRef.current[key] ?? 0) + 1;
        playGenRef.current[key] = myGen;

        const base64 = await prefetchAudio(word);

        if (playGenRef.current[key] !== myGen) return;

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
            try { soundRef.current.dispose(); } catch {}
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
              // stopPlayer() releases the native MediaPlayer/AVAudioPlayer — must be called
              // even after natural completion, otherwise native audio resources leak and
              // Android exhausts its player limit (~32) after enough tasks.
              try { sound.stopPlayer().catch(() => {}); } catch {}
              try { sound.dispose(); } catch {}
              resolve();
            });
            sound.startPlayer(tempPath).catch((err) => {
              sound.removePlaybackEndListener();
              soundRef.current = null;
              try { sound.stopPlayer().catch(() => {}); } catch {}
              try { sound.dispose(); } catch {}
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
