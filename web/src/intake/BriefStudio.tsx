// The Brief screen: one chat is the only input, and there are exactly two ways to make a film.
//  - a CSV feed: a catalog, which is one film per product made by the same crew, one after another (the CSV's photos go with it);
//  - anything else: one film. One photo, several photos (cut between them) or none (a photo is made from your words).
// The board on the left shows what the app understood, and only a missing photo in a feed is ever asked for.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiRequestError, api } from '../api/client';
import { rememberIntake } from '../crew/intakeHandoff';
import { createLineup } from '../lineup/api';
import Gallery from '../panels/Gallery';
import { railTabs } from '../shell/rail';
import { Slot } from '../shell/Slot';
import { StudioBoard } from '../shell/StudioBoard';
import { StudioShell } from '../shell/StudioShell';
import { openSettings } from '../settings/access';
import { useRecorder } from '../panels/useRecorder';
import { STEPS } from '../shell/steps';
import { matchPhotos, needingPhoto, parseFeed, readText, sortDropped, type FeedPreview } from './feed';
import '../crew/crew.css';
import './intake.css';

/** MuseReels makes vertical reels only. */
const ASPECT = '9:16';
const DEMO_FEED = 'feed-6';

const OPENER = 'What are we making? Tell me about the film. Add product photos if you have them, or a CSV feed for a catalog. No photo is fine: I will make one.';
const MAX_PHOTOS = 6;

function openUrl(set: (u: URL) => void) {
  const url = new URL(window.location.href);
  set(url);
  window.history.pushState({}, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function reasonOf(err: unknown): string {
  if (err instanceof ApiRequestError && err.body && typeof err.body === 'object') {
    const b = err.body as Record<string, unknown>;
    if (Array.isArray(b.errors) && b.errors.length) return `${String(b.error)}: ${b.errors.join('; ')}`;
    if (typeof b.message === 'string') return b.message;
    if (typeof b.error === 'string') return b.error;
  }
  return err instanceof Error ? err.message : 'That did not work. Try again.';
}

export function BriefStudio() {
  const [csv, setCsv] = useState<File>();
  const [photos, setPhotos] = useState<File[]>([]);
  const [feed, setFeed] = useState<FeedPreview>();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [drag, setDrag] = useState(false);
  const [sent, setSent] = useState('');
  const recorder = useRecorder();
  const picker = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!csv) return setFeed(undefined);
    let live = true;
    readText(csv).then((t) => live && setFeed(parseFeed(t)), () => live && setFeed({ products: [], error: 'That CSV could not be read.' }));
    return () => {
      live = false;
    };
  }, [csv]);

  const products = useMemo(() => matchPhotos(feed?.products ?? [], photos), [feed, photos]);
  const missing = needingPhoto(products);
  const ready = !!feed && !feed.error && products.length > 0;

  const take = (files: File[]) => {
    const got = sortDropped(files);
    setError(got.rejected.length ? `I can use a CSV or PNG, JPG and WEBP photos, not ${got.rejected.join(', ')}.` : '');
    if (got.csv) setCsv(got.csv);
    // photos add up: they match a feed's rows, or they are the film's own shots
    if (got.photos.length) {
      setPhotos((old) => {
        const fresh = got.photos.filter((p) => !old.some((o) => o.name === p.name && o.size === p.size));
        const next = [...old, ...fresh];
        if (next.length > MAX_PHOTOS && !csv && !got.csv) setError(`A film takes up to ${MAX_PHOTOS} photos; I kept the first ${MAX_PHOTOS}.`);
        return csv || got.csv ? next : next.slice(0, MAX_PHOTOS);
      });
    }
  };

  const remove = (file: File) => {
    if (file === csv) setCsv(undefined);
    else setPhotos((old) => old.filter((p) => p !== file));
  };

  const point = (name: string) => {
    setText((t) => `${t}${t && !t.endsWith(' ') ? ' ' : ''}[${name}] `);
    box.current?.focus();
  };

  // what Make film would do, in the order a person thinks about it
  const mode: 'feed' | 'film' = csv ? 'feed' : 'film';
  // a voice brief stands in for the words, for a film only: a catalog's brief is text
  const voice = mode === 'film' && !!recorder.blob;
  const canMake = !busy && recorder.state !== 'recording' && (mode === 'feed' ? ready && missing.length === 0 : voice || !!text.trim());

  async function make(demo = false) {
    setBusy(true);
    setError('');
    setSent(demo ? 'Try the example feed' : voice ? '🎙 Voice brief' : text.trim());
    try {
      if (demo || mode === 'feed') {
        const form = new FormData();
        if (demo) form.set('demo', DEMO_FEED);
        else {
          form.set('csv', csv!);
          for (const p of photos) form.append('photos', p, p.name);
        }
        form.set('aspect', ASPECT);
        if (text.trim()) form.set('brief', text.trim());
        const made = await createLineup(form);
        // the first product's film opens at once; the studio follows the crew to the next one as each finishes
        rememberIntake(made.filmIds[0]!, { text: demo ? 'Try the example feed' : text.trim() });
        openUrl((u) => {
          u.searchParams.set('lineup', made.lineupId);
          u.searchParams.set('film', made.filmIds[0]!);
          u.searchParams.delete('replay');
        });
      } else {
        // the first photo is the hero, the others are cut between; with none the server makes a photo from the brief
        const form = new FormData();
        for (const p of photos) form.append('photos', p, p.name);
        form.set('aspect', ASPECT);
        if (voice) form.set('audio', new File([recorder.blob!], 'brief.webm', { type: recorder.blob!.type || 'audio/webm' }));
        else form.set('brief', text.trim());
        const result = await api.createFilm(form);
        rememberIntake(result.filmId, { text: voice ? '' : text.trim(), voice, ...(photos[0] ? { photoUrl: URL.createObjectURL(photos[0]) } : {}) });
        openUrl((u) => u.searchParams.set('film', result.filmId));
      }
    } catch (err) {
      setSent('');
      if (err instanceof ApiRequestError && err.status === 401) {
        openSettings();
        setError('Add a Director code or your Muse API key in Settings, then try again.');
      } else setError(reasonOf(err));
      setBusy(false);
    }
  }

  const attached = [...(csv ? [csv] : []), ...photos];
  const audioUrl = useMemo(() => (recorder.blob ? URL.createObjectURL(recorder.blob) : undefined), [recorder.blob]);
  useEffect(() => () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  }, [audioUrl]);
  let crewSays: ReactNode = null;
  if (feed?.error) crewSays = feed.error;
  else if (ready && missing.length > 0) {
    crewSays = `Got ${products.length} product${products.length === 1 ? '' : 's'}. ${missing.length} of ${products.length} ${missing.length === 1 ? 'needs' : 'need'} a photo: drop ${missing.length === 1 ? 'it' : 'them'} anywhere on this screen.`;
  } else if (ready) {
    crewSays = `Got ${products.length} product${products.length === 1 ? '' : 's'}. Add a mood if you like, then make the film.`;
  } else if (mode === 'film') {
    const n = photos.length;
    const have = n === 0 ? 'No photo yet: I will make one from your description.' : n === 1 ? 'Got your photo.' : `Got ${n} photos: one film that cuts between them.`;
    crewSays = voice
      ? `${have} Got your voice brief. Nothing starts until you press Make film.`
      : text.trim()
        ? `${have} Ready when you are: press Make film to start.`
        : `${have} Now tell me the mood, the audience, anything it must show, or press 🎙 and say it.`;
  }

  const chat = (
    <div className="thread intake brief-chat">
      <div className="notes" role="log" aria-live="polite" aria-label="Conversation">
        <div className="bubble crew"><p>{OPENER}</p></div>
        {attached.length > 0 && (
          <div className="bubble you">
            <div className="brief-attached">
              {attached.map((f) => (
                <span key={`${f.name}-${f.size}`} className="chip is-on">
                  {f.name}
                  <button type="button" className="unattach" aria-label={`Remove ${f.name}`} onClick={() => remove(f)}>×</button>
                </span>
              ))}
            </div>
          </div>
        )}
        {voice && !sent && (
          <div className="bubble you k-audio">
            <audio controls src={audioUrl} />
            <button type="button" className="unattach" aria-label="Remove recording" onClick={recorder.reset}>×</button>
          </div>
        )}
        {sent && <div className="bubble you"><p>{sent}</p></div>}
        {crewSays && !busy && (
          <div className="bubble crew">
            <p>{crewSays}</p>
            {ready && missing.length > 0 && (
              <div className="quick">
                <button type="button" onClick={() => picker.current?.click()}>Choose photos</button>
              </div>
            )}
            {canMake && (
              <div className="quick">
                <button type="button" className="quick-make" onClick={() => void make()}>Send now</button>
                {voice && <button type="button" onClick={recorder.reset}>Record again</button>}
              </div>
            )}
          </div>
        )}
        {busy && <div className="bubble crew thinking"><span className="dots" aria-hidden="true"><i /><i /><i /></span><span className="think-secs">starting your film…</span></div>}
        {(error || recorder.error) && <div className="bubble crew"><p role="alert" className="crew-error">{error || recorder.error}</p></div>}
      </div>
      <div className="composer brief-composer">
        <button type="button" className="brief-dropzone" onClick={() => picker.current?.click()}>
          <span aria-hidden="true">+</span>
          <span>
            <b>{attached.length ? 'Add more photos or a CSV' : 'Drop photos or a CSV'}</b>
            <small>PNG, JPG, WEBP or CSV · drop anywhere, or click to choose</small>
          </span>
        </button>
        <div className="brief-box">
        <textarea
          ref={box}
          aria-label="Message"
          rows={2}
          maxLength={2000}
          placeholder={voice ? 'Voice brief recorded' : 'Describe the film: the mood, the audience, anything it must show…'}
          disabled={busy || voice}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (canMake) void make();
            }
          }}
        />
        <div className="brief-actions">
          <input
            ref={picker}
            hidden
            multiple
            aria-label="Photos or CSV"
            type="file"
            accept=".csv,text/csv,image/png,image/jpeg,image/webp"
            onChange={(e) => {
              take(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
          <button type="button" className="tool" aria-label="Attach photos or a CSV" onClick={() => picker.current?.click()}>📎</button>
          {mode === 'film' &&
            (recorder.state === 'recording' ? (
              <button type="button" className="tool rec" aria-label="Stop recording" onClick={recorder.stop}>■ {recorder.seconds}s</button>
            ) : (
              <button type="button" className="tool" aria-label="Record a voice brief" disabled={busy || !!recorder.blob} onClick={() => void recorder.start()}>🎙</button>
            ))}
          <button type="button" className={`brief-make${canMake ? ' is-ready' : ''}`} disabled={!canMake} onClick={() => void make()}>Make film</button>
        </div>
        </div>
        {!busy && attached.length === 0 && (
          <p className="composer-hint">
            New here?{' '}
            <button type="button" className="brief-example" onClick={() => void make(true)}>Try an example</button>
          </p>
        )}
      </div>
    </div>
  );

  const boardProducts = mode === 'film'
    ? photos.map((p, i) => ({ id: `${p.name}-${p.size}`, title: p.name, note: i === 0 && photos.length > 1 ? 'hero shot' : undefined }))
    : products.map((p) => ({ id: p.id || p.title, title: p.title, price: p.price, note: !p.photo && !p.inRepo ? 'needs a photo' : undefined }));
  const tabs = railTabs({
    board: <StudioBoard products={boardProducts} story={text} shots={[]} crew={[]} onPoint={point} />,
    gallery: <Slot name="gallery"><Gallery film={null} events={[]} /></Slot>,
  });

  return (
    <div
      className={`brief-drop${drag ? ' is-drag' : ''}`}
      data-testid="brief-studio"
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
        take(Array.from(e.dataTransfer.files ?? []));
      }}
    >
      <StudioShell
        title="New film"
        steps={STEPS}
        step={0}
        tabs={tabs}
        defaultTab="board"
        stage={
          <section className="slot stage" data-testid="slot-player">
            <div className="stage-empty">
              <div>
                <div className="phone" aria-hidden="true">▷</div>
                <p>Your film plays here as the shots land.</p>
              </div>
            </div>
          </section>
        }
        side={chat}
        sideTitle="Chat"
      />
    </div>
  );
}
