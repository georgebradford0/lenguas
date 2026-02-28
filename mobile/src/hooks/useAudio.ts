import { useRef, useCallback } from 'react';
import { Platform } from 'react-native';
import Sound from 'react-native-sound';
import RNFS from 'react-native-fs';
import { speak } from '../api/client';

// Enable playback in silence mode on iOS
Sound.setCategory('Playback');

export function useAudio(language = 'de') {
  const cacheRef = useRef<Record<string, Promise<string>>>({});
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const soundRef = useRef<Sound | null>(null);

  const prefetchAudio = useCallback((word: string) => {
    const key = `${language}:${word}`;
    if (!cacheRef.current[key]) {
      cacheRef.current[key] = speak(word, language);
    }
    return cacheRef.current[key];
  }, [language]);

  const playAudio = useCallback(
    async (word: string): Promise<void> => {
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

          // Wait for audio to finish playing
          await new Promise<void>((resolve, reject) => {
            audio.onended = () => resolve();
            audio.onerror = (err) => reject(err);
            audio.play().catch(reject);
          });
        } else {
          // Stop any currently playing sound
          if (soundRef.current) {
            soundRef.current.stop();
            soundRef.current.release();
            soundRef.current = null;
          }

          // Write base64 to temp file and play
          // Sanitize filename to avoid special characters; include language to avoid collisions
          const sanitizedWord = word.replace(/[^a-zA-Z0-9]/g, '_');
          const fileName = `audio_${language}_${sanitizedWord}.mp3`;
          const tempPath = `${RNFS.CachesDirectoryPath}/${fileName}`;

          // Validate base64 data
          if (!base64 || base64.length === 0) {
            console.error('Empty base64 audio data for word:', word);
            return;
          }

          // Write file with error handling
          try {
            await RNFS.writeFile(tempPath, base64, 'base64');
            console.log('Audio file written successfully:', fileName);
          } catch (writeError) {
            console.error('Failed to write audio file:', writeError);
            console.error('Path:', tempPath);
            return;
          }

          // Verify file exists before attempting playback
          const fileExists = await RNFS.exists(tempPath);
          if (!fileExists) {
            console.error('Audio file does not exist after write:', tempPath);
            return;
          }

          // Wait for sound to load and play
          // On iOS, use just the filename when it's in the caches directory
          await new Promise<void>((resolve, reject) => {
            const sound = new Sound(fileName, RNFS.CachesDirectoryPath, (error) => {
              if (error) {
                console.error('Failed to load sound:', error);
                console.error('Word:', word);
                console.error('FileName:', fileName);
                console.error('Full path:', tempPath);
                console.error('Caches directory:', RNFS.CachesDirectoryPath);
                reject(error);
                return;
              }
              soundRef.current = sound;
              sound.play((success) => {
                if (!success) {
                  console.error('Sound playback failed for:', word);
                  reject(new Error('Sound playback failed'));
                } else {
                  resolve();
                }
                sound.release();
              });
            });
          });
        }
      } catch (err) {
        console.error('Audio playback failed:', err);
        // Don't throw - just log and continue
      }
    },
    [prefetchAudio]
  );

  return { playAudio, prefetchAudio };
}
