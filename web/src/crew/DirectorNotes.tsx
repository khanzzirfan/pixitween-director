// Owned by S12d. What you said and what the showrunner answered, in time order. Questions come with one-click answers.
import { useEffect, useRef, type ReactNode } from 'react';
import { secondsSince } from './format';
import type { CrewState } from './crewReducer';

export interface Bubble {
  at: string;
  side: 'you' | 'crew';
  kind: 'heard' | 'note' | 'reply' | 'ask';
  text: string;
  options?: string[];
}

export function bubblesOf(crew: CrewState): Bubble[] {
  const mine: Bubble[] = crew.heard.map((h) => ({ at: h.at, side: 'you', kind: 'heard', text: h.text }));
  const theirs: Bubble[] = crew.notes.map((n) => ({ at: n.at, side: 'crew', kind: n.kind, text: n.text, ...(n.options ? { options: n.options } : {}) }));
  return [...mine, ...theirs].sort((a, b) => a.at.localeCompare(b.at));
}

export function DirectorNotes({ crew, now = Date.now(), onAsk, children }: { crew: CrewState; now?: number; onAsk(option: string): void; children?: ReactNode }) {
  const bubbles = bubblesOf(crew);
  const lastAsk = bubbles.findLastIndex((b) => b.kind === 'ask');
  const thinking = crew.lanes.showrunner?.state === 'thinking';
  const box = useRef<HTMLDivElement>(null);
  // scroll the thread itself, never the page around it
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [bubbles.length, thinking]);
  return (
    <div ref={box} className="notes" role="log" aria-live="polite" aria-label="Director's notes">
      {bubbles.length === 0 && !thinking && <p className="notes-empty">Tell the showrunner what to change. It listens while the crew builds.</p>}
      {bubbles.map((b, i) => (
        <div key={`${b.at}-${i}`} className={`bubble ${b.side} k-${b.kind}`}>
          {b.kind === 'heard' && <span className="heard-tag">heard</span>}
          <p>{b.text}</p>
          {b.options && (
            <div className="reply-chips">
              {b.options.map((o) => (
                <button key={o} type="button" className="chip" disabled={i !== lastAsk} onClick={() => onAsk(o)}>
                  {o}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      {thinking && (
        <div className="bubble crew thinking" aria-label="The showrunner is thinking">
          <span className="dots" aria-hidden="true"><i /><i /><i /></span>
          <span className="think-secs">thinking · {secondsSince(crew.lanes.showrunner?.since, now)} s</span>
        </div>
      )}
      {children}
    </div>
  );
}
