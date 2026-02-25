import { useState, useCallback, useRef, useEffect } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';
import { NitroSound } from 'react-native-nitro-sound';
import RNFS from 'react-native-fs';

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
  const recorderRef = useRef<NitroSound | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const autoStopTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Request microphone permission on Android
  const requestPermission = async (): Promise<boolean> => {
    console.log('[Recorder] Requesting permission, platform:', Platform.OS);
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

  const startRecording = useCallback(async () => {
    try {
      setError(null);

      // Request permission
      const hasPermission = await requestPermission();
      console.log('[Recorder] hasPermission:', hasPermission);
      if (!hasPermission) {
        setError('Microphone permission denied');
        return;
      }

      // Generate file path
      const fileName = `recording_${Date.now()}.m4a`;
      const path = Platform.select({
        ios: `${RNFS.CachesDirectoryPath}/${fileName}`,
        android: `${RNFS.CachesDirectoryPath}/${fileName}`,
        default: fileName,
      });

      console.log('[Recorder] Recording path:', path);
      recordingPathRef.current = path;

      // Create and start recorder
      console.log('[Recorder] Creating NitroSound instance...');
      recorderRef.current = await NitroSound.create({
        path,
        format: 'aac', // AAC format for better compatibility
        sampleRate: 44100,
        channels: 1,
      });
      console.log('[Recorder] NitroSound instance created, calling startRecording...');

      await recorderRef.current.startRecording();
      setIsRecording(true);
      console.log('[Recorder] Recording started successfully');
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
      console.error('[Recorder] Error details:', JSON.stringify(err, Object.getOwnPropertyNames(err)));
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

      if (!isRecording || !recorderRef.current || !recordingPathRef.current) {
        return null;
      }

      // Stop recording
      await recorderRef.current.stopRecording();
      setIsRecording(false);

      console.log('[Recorder] Stopped recording');
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

      // Release recorder
      await recorderRef.current.release();
      recorderRef.current = null;

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
      if (recorderRef.current) {
        recorderRef.current.stopRecording().catch(console.error);
        recorderRef.current.release().catch(console.error);
      }
    };
  }, []);

  return {
    startRecording,
    stopRecording,
    isRecording,
    recordingTime,
    error,
  };
}
