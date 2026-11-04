import { useEffect, useState } from 'react';
import { MUSE_KEY_HEADER, PASSCODE_HEADER, type VideoKeyStatus } from '@shared/api';

const CODE_KEY = 'director.passcode';
const MUSE_KEY = 'director.museKey';

export type AccessMode = 'code' | 'key' | 'none';

export interface SavedAccess {
  code: string;
  museKey: string;
}

export function readAccess(): SavedAccess {
  try {
    return { code: localStorage.getItem(CODE_KEY) ?? '', museKey: localStorage.getItem(MUSE_KEY) ?? '' };
  } catch {
    return { code: '', museKey: '' };
  }
}

export function saveAccess(next: SavedAccess): void {
  const code = next.code.trim();
  const museKey = next.museKey.trim();
  try {
    if (code) localStorage.setItem(CODE_KEY, code);
    else localStorage.removeItem(CODE_KEY);
    if (museKey) localStorage.setItem(MUSE_KEY, museKey);
    else localStorage.removeItem(MUSE_KEY);
  } catch {
    /* storage may be unavailable */
  }
  window.dispatchEvent(new Event('director-access'));
}

/** A saved code wins: the server then spends its own Muse key. Otherwise the visitor key is sent. */
export function accessMode(saved: SavedAccess = readAccess()): AccessMode {
  if (saved.code.trim()) return 'code';
  if (saved.museKey.trim()) return 'key';
  return 'none';
}

const videoOn = (video?: VideoKeyStatus | null): boolean => Boolean(video?.fal);

export function accessLabel(mode: AccessMode, video?: VideoKeyStatus | null): string {
  const videos = videoOn(video);
  if (mode === 'code') return videos ? 'Studio + video' : 'Studio key';
  if (mode === 'key') return videos ? 'Your keys' : 'Your key';
  return videos ? 'Video key' : 'Add a key';
}

export function credentialHeaders(): Record<string, string> {
  const saved = readAccess();
  const headers: Record<string, string> = {};
  if (saved.code.trim()) headers[PASSCODE_HEADER] = saved.code.trim();
  else if (saved.museKey.trim()) headers[MUSE_KEY_HEADER] = saved.museKey.trim();
  return headers;
}

export function openSettings(): void {
  window.dispatchEvent(new Event('director-open-settings'));
}

export function useVideoKeyStatus(): VideoKeyStatus | null {
  const [status, setStatus] = useState<VideoKeyStatus | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => {
      fetch('/api/video-keys')
        .then(async (response) => {
          if (!live || !response.ok) return;
          setStatus((await response.json()) as VideoKeyStatus);
        })
        .catch(() => undefined);
    };
    load();
    window.addEventListener('director-access', load);
    return () => {
      live = false;
      window.removeEventListener('director-access', load);
    };
  }, []);
  return status;
}

export function useAccessMode(): AccessMode {
  const [mode, setMode] = useState<AccessMode>(() => accessMode());
  useEffect(() => {
    const sync = () => setMode(accessMode());
    window.addEventListener('director-access', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('director-access', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return mode;
}
