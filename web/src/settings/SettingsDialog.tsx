import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { VideoKeyStatus, VideoKeyUpdate, VideoProvider } from '@shared/api';
import { accessMode, readAccess, saveAccess, type AccessMode } from './access';
import './settings.css';

const emptyVideo: VideoKeyStatus = { fal: false, higgsfield: false, revana: false };

async function readVideoKeys(): Promise<{ status: VideoKeyStatus; locked: boolean }> {
  const response = await fetch('/api/video-keys');
  if (response.status === 403) return { status: emptyVideo, locked: true };
  if (!response.ok) return { status: emptyVideo, locked: false };
  return { status: (await response.json()) as VideoKeyStatus, locked: false };
}

export function SettingsDialog({ onClose }: { onClose(): void }) {
  const saved = readAccess();
  const [code, setCode] = useState(saved.code);
  const [museKey, setMuseKey] = useState(saved.museKey);
  const [fal, setFal] = useState('');
  const [higgsfield, setHiggsfield] = useState('');
  const [revana, setRevana] = useState('');
  const [clear, setClear] = useState<VideoProvider[]>([]);
  const [video, setVideo] = useState<VideoKeyStatus>(emptyVideo);
  const [locked, setLocked] = useState(false);
  const [videoError, setVideoError] = useState('');
  const [busy, setBusy] = useState(false);
  const [hosted, setHosted] = useState<boolean | null>(null);
  const titleId = useId();
  const first = useRef<HTMLInputElement>(null);
  const mode: AccessMode = accessMode({ code, museKey });

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    let live = true;
    fetch('/api/health')
      .then((r) => r.json())
      .then((body: { metaConfigured?: boolean }) => {
        if (live) setHosted(Boolean(body.metaConfigured));
      })
      .catch(() => {
        if (live) setHosted(null);
      });
    readVideoKeys()
      .then((found) => {
        if (!live) return;
        setVideo(found.status);
        setLocked(found.locked);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const using = mode === 'code' ? 'Films will use the studio Muse key.' : mode === 'key' ? 'Films will use your Muse key.' : 'Add a Director code or your own Muse key before making a film.';
  const savedLabel = (provider: VideoProvider) => (video[provider] && !clear.includes(provider) ? 'Saved' : '');

  const toggleClear = (provider: VideoProvider) => {
    setClear((current) => (current.includes(provider) ? current.filter((name) => name !== provider) : [...current, provider]));
  };

  const save = async () => {
    setBusy(true);
    setVideoError('');
    const update: VideoKeyUpdate = {};
    if (fal.trim()) update.fal = fal.trim();
    if (higgsfield.trim()) update.higgsfield = higgsfield.trim();
    if (revana.trim()) update.revana = revana.trim();
    if (clear.length) update.clear = clear;
    const sending = Boolean(update.fal || update.higgsfield || update.revana || update.clear?.length);
    try {
      if (sending || locked) {
        const response = await fetch(`/api/video-keys${locked ? '?fresh=1' : ''}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(sending ? update : {}),
        });
        const body = (await response.json().catch(() => ({}))) as { error?: string; provider?: string };
        if (!response.ok) {
          setVideoError(body.error === 'ip_locked' ? 'This browser session is locked to another network.' : body.error === 'bad_key' ? `That ${body.provider ?? 'video'} key was not accepted.` : 'The video keys could not be saved.');
          setBusy(false);
          return;
        }
      }
      saveAccess({ code, museKey });
      onClose();
    } catch {
      setVideoError('The video keys could not be saved.');
      setBusy(false);
    }
  };

  const wipe = async () => {
    setCode('');
    setMuseKey('');
    setFal('');
    setHiggsfield('');
    setRevana('');
    setClear([]);
    setVideo(emptyVideo);
    setLocked(false);
    const response = await fetch(`/api/video-keys${locked ? '?fresh=1' : ''}`, { method: 'DELETE' }).catch(() => undefined);
    if (response?.status === 403) await fetch('/api/video-keys?fresh=1', { method: 'DELETE' }).catch(() => undefined);
    saveAccess({ code: '', museKey: '' });
  };

  return (
    <div className="set-back" onMouseDown={onClose}>
      <div className="set-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={(e) => e.stopPropagation()}>
        <header className="set-head">
          <div>
            <p className="set-kicker">Access</p>
            <h2 id={titleId}>Keys</h2>
          </div>
          <button type="button" className="set-x" aria-label="Close settings" onClick={onClose}>×</button>
        </header>
        <p className="set-lead">
          A Director code from us runs films on our Muse key. Without a code, this server uses the Muse key you paste here. Fal, Higgsfield, and Revana keys make 9:16 reels and stay on this browser session and this network.
        </p>
        <label className="set-field">
          <span>Director code</span>
          <input ref={first} type="password" autoComplete="off" spellCheck={false} value={code} placeholder="From the studio" onChange={(e) => setCode(e.target.value)} />
        </label>
        <label className="set-field">
          <span>Your Muse API key</span>
          <input type="password" autoComplete="off" spellCheck={false} value={museKey} placeholder="Used when there is no code" onChange={(e) => setMuseKey(e.target.value)} />
        </label>
        <label className="set-field">
          <span className="set-field-head"><span>Fal API key</span>{savedLabel('fal') && <span className="set-saved">{savedLabel('fal')}</span>}</span>
          <input type="password" autoComplete="off" spellCheck={false} value={fal} placeholder={video.fal ? 'Saved for this network' : 'Key from fal.ai'} onChange={(e) => setFal(e.target.value)} />
          {video.fal && <button type="button" className="set-remove" onClick={() => toggleClear('fal')}>{clear.includes('fal') ? 'Keep saved key' : 'Remove saved key'}</button>}
        </label>
        <label className="set-field">
          <span className="set-field-head"><span>Higgsfield API key</span>{savedLabel('higgsfield') && <span className="set-saved">{savedLabel('higgsfield')}</span>}</span>
          <input type="password" autoComplete="off" spellCheck={false} value={higgsfield} placeholder={video.higgsfield ? 'Saved for this network' : 'keyId:secret'} onChange={(e) => setHiggsfield(e.target.value)} />
          {video.higgsfield && <button type="button" className="set-remove" onClick={() => toggleClear('higgsfield')}>{clear.includes('higgsfield') ? 'Keep saved key' : 'Remove saved key'}</button>}
        </label>
        <label className="set-field">
          <span className="set-field-head"><span>Revana API key</span>{savedLabel('revana') && <span className="set-saved">{savedLabel('revana')}</span>}</span>
          <input type="password" autoComplete="off" spellCheck={false} value={revana} placeholder={video.revana ? 'Saved for this network' : 'Key from revana.si'} onChange={(e) => setRevana(e.target.value)} />
          {video.revana && <button type="button" className="set-remove" onClick={() => toggleClear('revana')}>{clear.includes('revana') ? 'Keep saved key' : 'Remove saved key'}</button>}
        </label>
        <p className={`set-status is-${mode}`} role="status">{using}</p>
        {locked && <p className="set-status is-locked" role="status">The keys in this browser were saved on another network. Saving again starts a new session for this network and leaves the old keys unused.</p>}
        {videoError && <p className="set-status is-locked" role="alert">{videoError}</p>}
        {hosted === false && <p className="set-note">This server has no studio key, so a Director code cannot spend one. Paste your own key.</p>}
        {hosted === true && <p className="set-note">A studio key is configured here. It is used only when the Director code matches.</p>}
        <div className="set-actions">
          <button type="button" className="set-ghost" onClick={() => void wipe()}>Clear</button>
          <button type="button" className="set-save" disabled={busy} onClick={() => void save()}>Save</button>
        </div>
      </div>
    </div>
  );
}

export function SettingsHost() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    const openIt = () => setOpen(true);
    window.addEventListener('director-open-settings', openIt);
    return () => window.removeEventListener('director-open-settings', openIt);
  }, []);
  if (!open) return null;
  return <SettingsDialog onClose={close} />;
}
