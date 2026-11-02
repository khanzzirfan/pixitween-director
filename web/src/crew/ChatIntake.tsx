// Owned by S12d. Start a film by chatting: attach a photo, say what you want, and the same thread carries on while it builds.
import { useEffect, useRef, useState } from 'react';
import { ApiRequestError, api } from '../api/client';
import { useRecorder } from '../panels/useRecorder';
import { OPENER } from './BriefBubbles';
import { Composer } from './ChatThread';
import { rememberIntake } from './intakeHandoff';
import './crew.css';

type Aspect = '16:9' | '9:16' | '1:1';

const messageOf = (e: unknown) =>
  e instanceof ApiRequestError && e.body && typeof e.body === 'object' && 'message' in e.body
    ? String(e.body.message)
    : e instanceof ApiRequestError && e.body && typeof e.body === 'object' && 'error' in e.body
      ? String(e.body.error)
      : e instanceof Error
        ? e.message
        : 'Unable to create film.';

export function ChatIntake() {
  const [product, setProduct] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>();
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [aspect, setAspect] = useState<Aspect>('16:9');
  const [sent, setSent] = useState<string | null>(null);
  const [passcode, setPasscode] = useState('');
  const [needPasscode, setNeedPasscode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [drag, setDrag] = useState(false);
  const recorder = useRecorder();
  const file = useRef<HTMLInputElement>(null);
  const composer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!product) return setPreview(undefined);
    const url = URL.createObjectURL(product);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [product]);

  const hasMessage = !!text.trim() || !!recorder.blob;
  const canSend = !!product && hasMessage && !busy;

  const choose = (next: File | null | undefined) => {
    if (!next) return;
    if (next.type && !next.type.startsWith('image/')) {
      setError('That file is not an image — choose a PNG, JPG or WEBP.');
      return;
    }
    setError('');
    setProduct(next);
  };

  async function send() {
    if (!canSend || !product) return;
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
    else form.set('brief', text.trim());
    try {
      setSent(recorder.blob ? '🎙 Voice brief' : text.trim());
      const result = await api.createFilm(form);
      rememberIntake(result.filmId, { text: recorder.blob ? '' : text.trim(), voice: !!recorder.blob, photoUrl: URL.createObjectURL(product) });
      const url = new URL(window.location.href);
      url.searchParams.set('film', result.filmId);
      history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    } catch (err) {
      setSent(null);
      if (err instanceof ApiRequestError && err.status === 401) setNeedPasscode(true);
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`thread intake${drag ? ' is-drag' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrag(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        choose(e.dataTransfer.files?.[0]);
      }}
    >
      <div className="notes" role="log" aria-live="polite" aria-label="Conversation">
        <div className="bubble crew"><p>{OPENER}</p></div>
        {preview && (
          <div className="bubble you k-image">
            <img src={preview} alt="Product preview" />
            <button type="button" className="unattach" aria-label="Remove photo" onClick={() => setProduct(null)}>×</button>
          </div>
        )}
        {sent && <div className="bubble you"><p>{sent}</p></div>}
        {recorder.blob && !sent && (
          <div className="bubble you k-audio">
            <audio controls src={URL.createObjectURL(recorder.blob)} />
            <button type="button" className="unattach" aria-label="Remove recording" onClick={recorder.reset}>×</button>
          </div>
        )}
        {busy && <div className="bubble crew thinking"><span className="dots" aria-hidden="true"><i /><i /><i /></span><span className="think-secs">starting your film…</span></div>}
        {product && !hasMessage && !busy && <div className="bubble crew"><p>Nice. Now tell me about the film: the mood, the audience, anything it must show.</p></div>}
      </div>
      {needPasscode && (
        <label className="passcode">
          Passcode
          <input aria-label="Passcode" type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} />
        </label>
      )}
      {(error || recorder.error) && <p role="alert" className="crew-error">{error || recorder.error}</p>}
      {!product && (
        <button type="button" className="dropzone" onClick={() => file.current?.click()}>
          <span className="dropzone-glyph" aria-hidden="true">+</span>
          <span className="dropzone-copy">
            <b>Drop a product photo</b>
            <small>PNG, JPG or WEBP · or click to choose</small>
          </span>
        </button>
      )}
      <div ref={composer}>
        <Composer
          value={text}
          onChange={setText}
          onSend={() => void send()}
          disabled={busy || !!recorder.blob}
          sendDisabled={!canSend}
          placeholder={recorder.blob ? 'Voice brief recorded' : 'Describe the film…'}
          hint={!product ? 'Attach a photo of the product to begin.' : 'Enter to send'}
          chips={
            <>
              {(['16:9', '9:16', '1:1'] as const).map((a) => (
                <button key={a} type="button" className={`chip${aspect === a ? ' is-on' : ''}`} aria-pressed={aspect === a} onClick={() => setAspect(a)}>{a}</button>
              ))}
              <input className="name-input" aria-label="Product name" placeholder="Product name (optional)" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />
            </>
          }
          tools={
            <>
              <input
                ref={file}
                hidden
                aria-label="Product photo"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  choose(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <button type="button" className="tool" aria-label="Attach a photo" onClick={() => file.current?.click()}>📎</button>
              {recorder.state === 'recording' ? (
                <button type="button" className="tool rec" aria-label="Stop recording" onClick={recorder.stop}>■ {recorder.seconds}s</button>
              ) : (
                <button type="button" className="tool" aria-label="Record a voice brief" disabled={!!recorder.blob} onClick={() => void recorder.start()}>🎙</button>
              )}
            </>
          }
        />
      </div>
    </div>
  );
}
