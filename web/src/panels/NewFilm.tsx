import { useEffect, useState, type FormEvent } from 'react';
import { ApiRequestError, api } from '../api/client';
import { ChatIntake } from '../crew/ChatIntake';
import { getCrewConfig } from '../crew/api';
import type { PanelProps } from './types';
import { useRecorder } from './useRecorder';

export const STUB_OWNER = 'S3b' as const;
type Aspect = '16:9' | '9:16' | '1:1';
const messageOf = (e: unknown) =>
  e instanceof ApiRequestError && e.body && typeof e.body === 'object' && 'message' in e.body
    ? String(e.body.message)
    : e instanceof ApiRequestError && e.body && typeof e.body === 'object' && 'error' in e.body
      ? String(e.body.error)
      : e instanceof Error
        ? e.message
        : 'Unable to create film.';

/** Crew mode starts a film by chatting; off, or when the question fails, the classic form. */
export default function NewFilm(props: PanelProps) {
  // undefined until the server has answered: the form waits invisibly, so nobody sees it flash before the chat
  const [crewOn, setCrewOn] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    let live = true;
    if (typeof fetch === 'function') getCrewConfig().then((c) => live && setCrewOn(c.enabled === true), () => live && setCrewOn(false));
    else setCrewOn(false);
    return () => {
      live = false;
    };
  }, []);
  // one wrapper in both cases, so a form someone already started typing in is not remounted when the answer arrives
  if (crewOn !== true) return <div style={crewOn === undefined ? { opacity: 0 } : undefined} aria-busy={crewOn === undefined}><ClassicNewFilm {...props} /></div>;
  return (
    <section>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">START WITH AN IDEA</span>
          <h2>Make a new film</h2>
        </div>
      </div>
      <ChatIntake />
    </section>
  );
}

function ClassicNewFilm(_props: PanelProps) {
  const [product, setProduct] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>();
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [aspect, setAspect] = useState<Aspect>('16:9');
  const [passcode, setPasscode] = useState('');
  const [needPasscode, setNeedPasscode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const recorder = useRecorder();

  useEffect(() => {
    if (!product) {
      setPreview(undefined);
      return;
    }
    const url = URL.createObjectURL(product);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [product]);
  const enabled = !!product && (!!recorder.blob || !!brief.trim()) && !busy;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!enabled || !product) return;
    setBusy(true);
    setError('');
    if (needPasscode) {
      try {
        localStorage.setItem('director.passcode', passcode);
      } catch {
        /* storage may be unavailable */
      }
    }
    const form = new FormData();
    form.set('product', product);
    form.set('aspect', aspect);
    if (title.trim()) form.set('title', title.trim());
    if (recorder.blob) form.set('audio', new File([recorder.blob], 'brief.webm', { type: recorder.blob.type || 'audio/webm' }));
    else form.set('brief', brief.trim());
    try {
      const result = await api.createFilm(form);
      const url = new URL(window.location.href);
      url.searchParams.set('film', result.filmId);
      history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) setNeedPasscode(true);
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">START WITH AN IDEA</span>
          <h2>Make a new film</h2>
        </div>
        <span className="step-pill">01 / 03</span>
      </div>
      <p className="panel-intro">Add your product and a few words. Your director will turn the brief into a storyboard.</p>
      <label>
        Product photo
        <input
          aria-label="Product photo"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => setProduct(e.target.files?.[0] ?? null)}
        />
      </label>
      {preview && <img className="product-preview" alt="Product preview" src={preview} />}
      <label>
        Product name <input aria-label="Product name" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        Brief{' '}
        <textarea aria-label="Brief" maxLength={2000} value={brief} disabled={!!recorder.blob} onChange={(e) => setBrief(e.target.value)} />
      </label>
      <p>{brief.length} / 2000</p>
      <fieldset>
        <legend>Video format</legend>
        {(['16:9', '9:16', '1:1'] as const).map((item) => (
          <label key={item}>
            <input type="radio" name="aspect" value={item} checked={aspect === item} onChange={() => setAspect(item)} />
            {item}
          </label>
        ))}
      </fieldset>
      {recorder.state === 'recording' ? (
        <>
          <p>{recorder.seconds} s</p>
          <button type="button" onClick={recorder.stop}>
            Stop recording
          </button>
        </>
      ) : (
        <button type="button" className="subtle-button" aria-label="Record a voice brief" onClick={() => void recorder.start()}>
          Record a voice brief
        </button>
      )}
      {recorder.blob && (
        <>
          <audio controls src={URL.createObjectURL(recorder.blob)} />
          <button type="button" onClick={recorder.reset}>
            Remove recording
          </button>
        </>
      )}
      {recorder.error && <p role="alert">{recorder.error}</p>}
      {needPasscode && (
        <label>
          Passcode <input aria-label="Passcode" type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} />
        </label>
      )}
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={!enabled}>
        {busy ? 'Starting your film…' : 'Create my storyboard →'}
      </button>
    </form>
  );
}
