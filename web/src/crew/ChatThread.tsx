// Owned by S12d. The conversation with the showrunner: a thread, a composer, and a ready bubble when the film is done.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DirectorNotes } from './DirectorNotes';
import type { CrewState } from './crewReducer';
import { PushToTalk } from './PushToTalk';

export interface ComposerProps {
  value: string;
  onChange(v: string): void;
  onSend(): void;
  disabled?: boolean;
  sendDisabled?: boolean;
  hint?: string;
  placeholder?: string;
  /** Buttons to the left of the send button (attach, record). */
  tools?: ReactNode;
  /** Chips above the box (aspect, name). */
  chips?: ReactNode;
}

export function Composer({ value, onChange, onSend, disabled, sendDisabled, hint, placeholder, tools, chips }: ComposerProps) {
  return (
    <div className="composer">
      {chips && <div className="composer-chips">{chips}</div>}
      <div className="composer-row">
        {tools}
        <textarea
          aria-label="Message"
          rows={1}
          maxLength={2000}
          placeholder={placeholder ?? 'Tell the showrunner…'}
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (!sendDisabled) onSend();
            }
          }}
        />
        <button type="button" className="send" aria-label="Send" disabled={disabled || sendDisabled || !value.trim()} onClick={onSend}>
          <span aria-hidden="true">↑</span>
        </button>
      </div>
      {hint && <p className="composer-hint">{hint}</p>}
    </div>
  );
}

export interface ReadyBubbleProps {
  posterUrl?: string;
  aspect: '16:9' | '9:16' | '1:1';
  onPlay(): void;
}
export function ReadyBubble({ posterUrl, aspect, onPlay }: ReadyBubbleProps) {
  return (
    <div className="bubble crew k-ready">
      <p>Your film is ready</p>
      <div className={`poster a-${aspect.replace(':', 'x')}`}>
        {posterUrl && <img src={posterUrl} alt="First frame of your film" />}
        <button type="button" className="play" aria-label="Play" onClick={onPlay}>▶ Play</button>
      </div>
    </div>
  );
}

export interface ChatThreadProps {
  crew: CrewState;
  now?: number;
  filmStatus?: string;
  aspect: '16:9' | '9:16' | '1:1';
  /** The product photo, the poster when the first frame cannot be read. */
  productUrl?: string;
  getPoster?(): Promise<string | undefined>;
  onPlay(): void;
  onSend(text: string): Promise<unknown> | void;
  onVoice(blob: Blob): Promise<unknown> | void;
  /** A replay: the thread is shown with no composer, no push-to-talk and no answer chips. */
  readOnly?: boolean;
}

export function ChatThread({ crew, now, filmStatus, aspect, productUrl, getPoster, onPlay, onSend, onVoice, readOnly }: ChatThreadProps) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [poster, setPoster] = useState<string | undefined>();
  const ready = filmStatus === 'ready';
  const asked = useRef(false);
  useEffect(() => {
    if (!ready || asked.current) return;
    asked.current = true;
    (async () => {
      try {
        setPoster((await getPoster?.()) ?? productUrl);
      } catch {
        setPoster(productUrl);
      }
    })();
  }, [ready, getPoster, productUrl]);

  const send = async (t: string) => {
    const v = t.trim();
    if (!v) return;
    setError('');
    try {
      await onSend(v);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The message did not go through.');
    }
  };
  return (
    <div className="thread">
      <DirectorNotes crew={crew} now={now} onAsk={(o) => void send(o)} readOnly={readOnly}>
        {ready && <ReadyBubble posterUrl={poster ?? productUrl} aspect={aspect} onPlay={onPlay} />}
      </DirectorNotes>
      {error && <p role="alert" className="crew-error">{error}</p>}
      {!readOnly && (
      <Composer
        value={text}
        onChange={setText}
        onSend={() => { const t = text; setText(''); void send(t); }}
        hint="Enter to send · hold Space to talk"
        tools={<PushToTalk onVoice={onVoice} />}
      />
      )}
    </div>
  );
}
