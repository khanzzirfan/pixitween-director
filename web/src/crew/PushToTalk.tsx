// Owned by S12d. Hold the button (or Space) to speak to the showrunner; letting go sends the audio.
import { useCallback, useEffect, useRef, useState } from 'react';

type Phase = 'idle' | 'listening' | 'sending' | 'sent' | 'denied' | 'error';

const inTextField = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.isContentEditable);
};

export function PushToTalk({ onVoice, disabled }: { onVoice(blob: Blob): Promise<unknown> | void; disabled?: boolean }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const holding = useRef(false);
  const sendRef = useRef(onVoice);
  sendRef.current = onVoice;

  const release = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };

  const start = useCallback(async () => {
    if (holding.current || disabled) return;
    holding.current = true;
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!holding.current) {
        media.getTracks().forEach((t) => t.stop()); // let go before the permission came back
        return;
      }
      stream.current = media;
      const mimeType = typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : undefined;
      const r = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
      chunks.current = [];
      r.ondataavailable = (ev) => ev.data.size && chunks.current.push(ev.data);
      r.onstop = async () => {
        release();
        const blob = new Blob(chunks.current, { type: r.mimeType || 'audio/webm' });
        if (!blob.size) return setPhase('idle');
        setPhase('sending');
        try {
          await sendRef.current(blob);
          setPhase('sent');
          setTimeout(() => setPhase((p) => (p === 'sent' ? 'idle' : p)), 1800);
        } catch {
          setPhase('error');
        }
      };
      rec.current = r;
      r.start();
      setPhase('listening');
    } catch {
      holding.current = false;
      release();
      setPhase('denied');
    }
  }, [disabled]);

  const stop = useCallback(() => {
    holding.current = false;
    if (rec.current?.state === 'recording') rec.current.stop();
    else if (phase === 'listening') setPhase('idle');
  }, [phase]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || inTextField(e.target)) return;
      e.preventDefault();
      void start();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !holding.current) return;
      e.preventDefault();
      stop();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [start, stop]);
  useEffect(() => () => release(), []);

  const denied = phase === 'denied';
  const label = { idle: 'Hold to talk', listening: 'Listening…', sending: 'Sending…', sent: 'Sent', denied: 'Microphone blocked', error: 'Try again' }[phase];
  return (
    <div className={`ptt ptt-${phase}`}>
      <button
        type="button"
        className="ptt-button"
        aria-pressed={phase === 'listening'}
        aria-label="Push to talk"
        disabled={disabled || denied}
        title={denied ? 'Allow the microphone in your browser to talk to the showrunner.' : 'Hold, or hold Space'}
        onPointerDown={(e) => { e.preventDefault(); void start(); }}
        onPointerUp={stop}
        onPointerLeave={() => holding.current && stop()}
      >
        <span className="ptt-icon" aria-hidden="true" />
        <span className="ptt-label">{label}</span>
      </button>
      {denied && <span className="ptt-reason" role="status">Allow the microphone to use your voice.</span>}
    </div>
  );
}
