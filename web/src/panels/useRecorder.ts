import { useCallback, useEffect, useRef, useState } from 'react';

type RecorderState = 'idle' | 'recording' | 'recorded' | 'error';
export function useRecorder(o: { maxSeconds?: number } = {}) {
  const maxSeconds = o.maxSeconds ?? 60;
  const [state, setState] = useState<RecorderState>('idle');
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startAt = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const release = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }, []);
  const stop = useCallback(() => {
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }, []);
  const reset = useCallback(() => {
    stop();
    release();
    recorder.current = null;
    chunks.current = [];
    setBlob(null);
    setSeconds(0);
    setError(null);
    setState('idle');
  }, [release, stop]);

  const start = useCallback(async () => {
    setError(null);
    setSeconds(0);
    setBlob(null);
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = media;
      const mimeType =
        typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : undefined;
      const instance = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
      recorder.current = instance;
      chunks.current = [];
      startAt.current = Date.now();
      instance.ondataavailable = (event) => {
        if (event.data.size) chunks.current.push(event.data);
      };
      instance.onstop = () => {
        setBlob(new Blob(chunks.current, { type: instance.mimeType || 'audio/webm' }));
        setState('recorded');
        release();
      };
      instance.start();
      setState('recording');
      timer.current = setInterval(() => {
        const elapsed = Math.min(maxSeconds, Math.floor((Date.now() - startAt.current) / 1000));
        setSeconds(elapsed);
        if (elapsed >= maxSeconds) stop();
      }, 1000);
    } catch {
      release();
      setError('Microphone permission was denied.');
      setState('error');
    }
  }, [maxSeconds, release, stop]);
  useEffect(
    () => () => {
      if (recorder.current?.state === 'recording') recorder.current.stop();
      release();
    },
    [release],
  );
  return { state, seconds, blob, error, start, stop, reset };
}
