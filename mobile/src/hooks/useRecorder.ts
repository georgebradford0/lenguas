import { useState, useCallback, useRef, useEffect } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import RNFS from 'react-native-fs';

const audioRecorderPlayer = new AudioRecorderPlayer();

export interface RecorderHook {
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<string | null>;
  isRecording: boolean;
  recordingTime: number;
  error: string | null;
}

const MAX_RECORDING_TIME = 5000; // 5 seconds in milliseconds

export function useRecorder(): RecorderHook {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recordingPathRef = useRef<string | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const autoStopTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Request microphone permission on Android
  const requestPermission = async (): Promise<boolean> => {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          {
            title: 'Microphone Permission',
            message: 'This app needs microphone access to practice German pronunciation',
            buttonNeutral: 'Ask Me Later',
            buttonNegative: 'Cancel',
            buttonPositive: 'OK',
          }
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      } catch (err) {
        console.error('Permission request error:', err);
        return false;
      }
    }
    // iOS permission is requested automatically on first use
    return true;
  };

  const startRecording = useCallback(async () => {
    try {
      setError(null);

      // Request permission
      const hasPermission = await requestPermission();
      if (!hasPermission) {
        setError('Microphone permission denied');
        return;
      }

      // Generate file path
      const fileName = `recording_${Date.now()}.mp3`;
      const path = Platform.select({
        ios: `${RNFS.CachesDirectoryPath}/${fileName}`,
        android: `${RNFS.CachesDirectoryPath}/${fileName}`,
        default: fileName,
      });

      recordingPathRef.current = path;

      // Start recording
      await audioRecorderPlayer.startRecorder(path);
      setIsRecording(true);
      setRecordingTime(0);

      // Start timer
      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 100);
      }, 100);

      // Auto-stop after 5 seconds
      autoStopTimeoutRef.current = setTimeout(async () => {
        await stopRecording();
      }, MAX_RECORDING_TIME);

      console.log('[Recorder] Started recording to:', path);
    } catch (err) {
      console.error('[Recorder] Start error:', err);
      setError('Failed to start recording');
      setIsRecording(false);
    }
  }, []);

  const stopRecording = useCallback(async (): Promise<string | null> => {
    try {
      // Clear timers
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (autoStopTimeoutRef.current) {
        clearTimeout(autoStopTimeoutRef.current);
        autoStopTimeoutRef.current = null;
      }

      if (!isRecording || !recordingPathRef.current) {
        return null;
      }

      // Stop recording
      const result = await audioRecorderPlayer.stopRecorder();
      setIsRecording(false);

      console.log('[Recorder] Stopped recording, result:', result);
      console.log('[Recorder] File path:', recordingPathRef.current);

      // Read file as base64
      const fileExists = await RNFS.exists(recordingPathRef.current);
      if (!fileExists) {
        console.error('[Recorder] File does not exist:', recordingPathRef.current);
        setError('Recording file not found');
        return null;
      }

      const base64 = await RNFS.readFile(recordingPathRef.current, 'base64');
      console.log('[Recorder] Read base64, length:', base64.length);

      // Clean up file
      await RNFS.unlink(recordingPathRef.current);

      return base64;
    } catch (err) {
      console.error('[Recorder] Stop error:', err);
      setError('Failed to stop recording');
      setIsRecording(false);
      return null;
    }
  }, [isRecording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (autoStopTimeoutRef.current) {
        clearTimeout(autoStopTimeoutRef.current);
      }
      if (isRecording) {
        audioRecorderPlayer.stopRecorder().catch(console.error);
      }
    };
  }, [isRecording]);

  return {
    startRecording,
    stopRecording,
    isRecording,
    recordingTime,
    error,
  };
}
