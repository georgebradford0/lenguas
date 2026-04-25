import { useState, useCallback, useRef, useEffect } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';
import { createSound } from 'react-native-nitro-sound';
import type { Sound } from 'react-native-nitro-sound';
import RNFS from 'react-native-fs';
import type { Language } from '../types';
import { getLanguageName } from '../types';

export interface RecorderHook {
  prepareRecording: () => Promise<void>;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<string | null>;
  isRecording: boolean;
  recordingTime: number;
  error: string | null;
}


export function useRecorder(language: Language = 'de'): RecorderHook {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const soundRef = useRef<Sound | null>(null);
  const recordingPathRef = useRef<string | null>(null);
  const isRecordingRef = useRef(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  // iOS pre-warm state: start+pause on mount so AVAudioSession is active before user taps
  const preparedSoundRef = useRef<Sound | null>(null);
  const preparedPathRef = useRef<string | null>(null);

  // Request microphone permission on Android
  const requestPermission = async (): Promise<boolean> => {
    console.log('[Recorder] Requesting permission, platform:', Platform.OS);
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          {
            title: 'Microphone Permission',
            message: `This app needs microphone access to practice ${getLanguageName(language)} pronunciation`,
            buttonNeutral: 'Ask Me Later',
            buttonNegative: 'Cancel',
            buttonPositive: 'OK',
          }
        );
        console.log('[Recorder] Android permission result:', granted);
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      } catch (err) {
        console.error('[Recorder] Permission request error:', err);
        return false;
      }
    }
    // iOS permission is requested automatically on first use
    console.log('[Recorder] iOS - permission will be requested by system on first use');
    return true;
  };

  const stopRecording = useCallback(async (): Promise<string | null> => {
    try {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (!isRecordingRef.current || !soundRef.current || !recordingPathRef.current) {
        console.log('[Recorder] stopRecording called but not recording, skipping');
        return null;
      }

      console.log('[Recorder] Stopping recording...');
      await soundRef.current.stopRecorder();
      setIsRecording(false);
      isRecordingRef.current = false;

      const filePath = recordingPathRef.current;
      console.log('[Recorder] Stopped, file path:', filePath);

      soundRef.current = null;

      const fileExists = await RNFS.exists(filePath);
      if (!fileExists) {
        console.error('[Recorder] File does not exist:', filePath);
        setError('Recording file not found');
        return null;
      }

      const base64 = await RNFS.readFile(filePath, 'base64');
      console.log('[Recorder] Read base64, length:', base64.length);

      await RNFS.unlink(filePath);

      return base64;
    } catch (err) {
      console.error('[Recorder] Stop error:', err);
      console.error('[Recorder] Error details:', JSON.stringify(err, Object.getOwnPropertyNames(err)));
      setError('Failed to stop recording');
      setIsRecording(false);
      isRecordingRef.current = false;
      soundRef.current = null;
      return null;
    }
  }, []);

  // iOS-only: warm up AVAudioSession by starting and immediately pausing.
  // Call this when the speech recognition task mounts so the session is
  // already active when the user taps record.
  const prepareRecording = useCallback(async () => {
    if (Platform.OS !== 'ios') return;
    try {
      const hasPermission = await requestPermission();
      if (!hasPermission) return;

      const fileName = `recording_prep_${Date.now()}.m4a`;
      const path = `${RNFS.CachesDirectoryPath}/${fileName}`;
      const sound = createSound();
      await sound.startRecorder(path, {
        AVEncodingOptionIOS: 'aac',
        AVNumberOfChannelsKeyIOS: 1,
        AVSampleRateKeyIOS: 44100,
      });
      await sound.pauseRecorder();
      preparedSoundRef.current = sound;
      preparedPathRef.current = path;
      console.log('[Recorder] AVAudioSession pre-warmed');
    } catch (err) {
      // Non-fatal — startRecording will fall back to a cold start
      console.warn('[Recorder] Pre-warm failed:', err);
      preparedSoundRef.current = null;
      preparedPathRef.current = null;
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      setError(null);

      const hasPermission = await requestPermission();
      console.log('[Recorder] hasPermission:', hasPermission);
      if (!hasPermission) {
        setError('Microphone permission denied');
        return;
      }

      if (Platform.OS === 'ios' && preparedSoundRef.current && preparedPathRef.current) {
        // Resume the pre-warmed session — AVAudioSession is already active, no lag
        console.log('[Recorder] Resuming pre-warmed recorder...');
        soundRef.current = preparedSoundRef.current;
        recordingPathRef.current = preparedPathRef.current;
        preparedSoundRef.current = null;
        preparedPathRef.current = null;
        await soundRef.current.resumeRecorder();
      } else {
        // Cold start (Android, or iOS pre-warm failed)
        const fileName = `recording_${Date.now()}.m4a`;
        const path = `${RNFS.CachesDirectoryPath}/${fileName}`;
        console.log('[Recorder] Recording path:', path);
        recordingPathRef.current = path;

        console.log('[Recorder] Creating Sound instance...');
        soundRef.current = createSound();

        console.log('[Recorder] Calling startRecorder...');
        await soundRef.current.startRecorder(path, {
          AVEncodingOptionIOS: 'aac',
          AVNumberOfChannelsKeyIOS: 1,
          AVSampleRateKeyIOS: 44100,
        });
      }

      setIsRecording(true);
      isRecordingRef.current = true;
      setRecordingTime(0);
      console.log('[Recorder] Recording started successfully');

      // Start timer
      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 100);
      }, 100);

    } catch (err) {
      console.error('[Recorder] Start error:', err);
      console.error('[Recorder] Error details:', JSON.stringify(err, Object.getOwnPropertyNames(err)));
      setError('Failed to start recording');
      setIsRecording(false);
      isRecordingRef.current = false;
      soundRef.current = null;
    }
  }, [stopRecording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (soundRef.current && isRecordingRef.current) {
        soundRef.current.stopRecorder().catch(console.error);
        soundRef.current = null;
      }
      if (preparedSoundRef.current) {
        const sound = preparedSoundRef.current;
        const path = preparedPathRef.current;
        preparedSoundRef.current = null;
        preparedPathRef.current = null;
        sound.stopRecorder()
          .then(() => path ? RNFS.unlink(path).catch(() => {}) : undefined)
          .catch(console.error);
      }
    };
  }, []);

  return {
    prepareRecording,
    startRecording,
    stopRecording,
    isRecording,
    recordingTime,
    error,
  };
}
