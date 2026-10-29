import { useCallback, useState } from 'react';
import type { AepCompositionJson } from 'reacthub-pixitweenjs';
import { api } from '../api/client';
import type { PlayerHandle } from '../player/Player';
import { LayerList } from '../selection/LayerList';
import { SelectionOverlay } from '../selection/SelectionOverlay';
import { useCanvasSelect } from '../selection/useCanvasSelect';
import { useSelection } from '../selection/useSelection';
import { useChat } from './useChat';
import BackendBadge from './BackendBadge';
import type { PanelProps } from './types';
export const STUB_OWNER = 'S6' as const;
export interface ChatProps extends PanelProps {
  filmId?: string;
  comp?: AepCompositionJson | null;
  version?: number;
  player?: PlayerHandle | null;
}
export default function Chat({
  film,
  events,
  filmId = film?.id,
  comp = film?.composition,
  version = film?.version ?? 0,
  player,
}: ChatProps) {
  const { selection, select, clear } = useSelection();
  const pick = useCallback((s: any) => (s ? select(s) : clear()), [select, clear]);
  useCanvasSelect({ player, comp, onPick: pick });
  const chat = useChat({ filmId, version, events, api });
  const [text, setText] = useState('');
  if (!filmId)
    return (
      <section>
        <header className="panel-heading">
          <div>
            <span className="eyebrow">DIRECTOR'S DESK</span>
            <h2>Edit your film</h2>
          </div>
          <BackendBadge events={events} />
        </header>
        <p>Open or create a film to start editing.</p>
      </section>
    );
  const send = () => {
    const value = text.trim();
    if (value) {
      void chat.send(value, selection);
      setText('');
    }
  };
  return (
    <section>
      <header className="panel-heading">
        <div>
          <span className="eyebrow">DIRECTOR'S DESK</span>
          <h2>Edit your film</h2>
        </div>
        <BackendBadge events={events} />
      </header>
      <details>
        <summary>Layers</summary>
        <LayerList comp={comp ?? undefined} selection={selection} onSelect={select} />
      </details>
      <SelectionOverlay player={player} comp={comp ?? undefined} selection={selection} />
      {selection && (
        <p>
          Editing: {selection.layerId ?? selection.sceneId}{' '}
          <button type="button" aria-label="Clear selection" onClick={clear}>
            ×
          </button>
        </p>
      )}
      <div aria-live="polite">
        {chat.messages.map((m, i) => (
          <article className={`chat-message chat-${m.role}`} key={i} role={m.role === 'error' ? 'alert' : undefined} data-kind={m.role}>
            <p>{m.text}</p>
            {m.items?.map((item, j) => (
              <p key={j}>{item}</p>
            ))}
            {m.reply && <p>{m.reply}</p>}
          </article>
        ))}
      </div>
      <label className="chat-composer">
        <span>What would you like to change?</span>
        <textarea
          aria-label="Edit request"
          maxLength={2000}
          disabled={chat.busy}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <span className="composer-hint">Enter to send · Shift + Enter for a new line</span>
      </label>
      <div className="chat-actions">
        <button type="button" className="primary" disabled={!text.trim() || chat.busy} onClick={send}>
          {chat.busy ? 'Working…' : 'Send request →'}
        </button>
        <button type="button" disabled={!chat.canUndo || chat.busy} onClick={() => void chat.undo()}>
          Undo
        </button>
        <button type="button" disabled={!chat.canRedo || chat.busy} onClick={() => void chat.redo()}>
          Redo
        </button>
      </div>
      {chat.busy && <p>Thinking... {chat.elapsedSec} s</p>}
      {chat.error && <p role="alert">{chat.error}</p>}
    </section>
  );
}
