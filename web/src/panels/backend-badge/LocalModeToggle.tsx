import { useCallback, useEffect, useState } from 'react';
import type { LocalModeResponse } from '@shared/api';
import { api, ApiRequestError } from '../../api/client';

type PutResult = LocalModeResponse | { error: string; message?: string };

export interface LocalModeToggleProps {
  fetchStatus?: () => Promise<LocalModeResponse>;
  putLocal?: (v: boolean) => Promise<PutResult>;
}

const POLL_MS = 30_000;

async function defaultPut(v: boolean): Promise<PutResult> {
  try {
    return await api.putLocalMode(v);
  } catch (e) {
    if (e instanceof ApiRequestError && typeof e.body === 'object' && e.body && 'error' in e.body) return e.body as { error: string; message?: string };
    throw e;
  }
}

export function LocalModeToggle({ fetchStatus = api.getLocalMode, putLocal = defaultPut }: LocalModeToggleProps) {
  const [status, setStatus] = useState<LocalModeResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    fetchStatus().then(setStatus, () => undefined);
  }, [fetchStatus]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const on = status?.local ?? false;
  const unavailable = !!status && (!status.reachable || !status.modelPresent);
  let line = 'Checking Ollama…';
  if (status) {
    if (!status.reachable) line = `Ollama is not reachable at ${status.host}. Start it with \`ollama serve\`.`;
    else if (!status.modelPresent) line = `Model not found. Pull it with \`ollama pull ${status.model}\`.`;
    else line = `Muse Glimmer 30B on ${status.host} - ready`;
  }

  const toggle = async () => {
    if (!status || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const r = await putLocal(!on);
      if ('local' in r) setStatus(r);
      else setMessage(r.message ?? r.error);
    } catch {
      setMessage('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="local-mode-toggle">
      <label>
        <input type="checkbox" role="switch" aria-label="Local mode (Muse Glimmer)" checked={on} disabled={!status || busy || (unavailable && !on)} onChange={() => void toggle()} />
        <span>Local mode (Muse Glimmer)</span>
      </label>
      <p className="local-mode-status">{line}</p>
      {message && <p role="alert">{message}</p>}
      {on && <p>Edits stay on this computer. New art still uses the Meta API.</p>}
    </div>
  );
}
