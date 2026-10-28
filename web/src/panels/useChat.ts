import { useEffect, useState } from 'react';
import type { FilmEvent } from '@shared/events';
import type { EditSelection } from '../selection/useSelection';
type Message = { role: 'user' | 'applied' | 'error'; text: string; items?: string[]; reply?: string };
type ChatApi = {
  chat(id: string, body: { message: string; selection?: EditSelection }): Promise<unknown>;
  undo(id: string): Promise<unknown>;
  redo(id: string): Promise<unknown>;
};
export function useChat(o: { filmId?: string; version: number; events: FilmEvent[]; api: ChatApi }) {
  const [messages, setMessages] = useState<Message[]>([]),
    [busy, setBusy] = useState(false),
    [elapsedSec, setElapsed] = useState(0),
    [error, setError] = useState<string>(),
    [canRedo, setCanRedo] = useState(false);
  const [startIndex, setStart] = useState(0);
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  useEffect(() => {
    if (!busy) return;
    const tail = o.events.slice(startIndex);
    if (!tail.some((e) => e.type === 'film.status' && e.status === 'ready')) return;
    const errors = tail.flatMap((e) => (e.type === 'error' ? [{ role: 'error' as const, text: e.message }] : []));
    const calls = tail.flatMap((e) => (e.type === 'tool.call' ? [e] : []));
    const reply = tail.findLast((e) => e.type === 'agent.turn' && e.reply);
    const applied: Message[] = calls.length
      ? [
          {
            role: 'applied',
            items: calls.map((e) => {
              const layerId = (e.args as { layerId?: string } | undefined)?.layerId;
              return layerId ? `${e.name} ${layerId}` : e.name;
            }),
            reply: reply?.type === 'agent.turn' ? reply.reply : undefined,
            text: 'Changes applied',
          },
        ]
      : [];
    // errors are appended once, when the edit settles, so re-renders cannot duplicate them
    setMessages((m) => [...m, ...errors, ...applied]);
    setBusy(false);
  }, [o.events, busy, startIndex]);
  const send = async (text: string, selection?: EditSelection) => {
    if (!o.filmId || !text.trim() || busy) return;
    setMessages((m) => [...m, { role: 'user', text: text.trim() }]);
    setBusy(true);
    setElapsed(0);
    setError(undefined);
    setCanRedo(false);
    setStart(o.events.length);
    try {
      await o.api.chat(o.filmId, { message: text.trim(), selection });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'request failed';
      setError(msg);
      setMessages((m) => [...m, { role: 'error', text: msg }]);
      setBusy(false);
    }
  };
  const step = async (action: 'undo' | 'redo') => {
    if (!o.filmId) return;
    try {
      await o.api[action](o.filmId);
      setCanRedo(action === 'undo');
    } catch (e) {
      const msg = e instanceof Error ? e.message : `${action} failed`;
      setError(msg);
      setMessages((m) => [...m, { role: 'error', text: msg }]);
    }
  };
  const undo = () => step('undo');
  const redo = () => step('redo');
  return { messages, busy, elapsedSec, canUndo: o.version > 1, canRedo, error, send, undo, redo };
}
