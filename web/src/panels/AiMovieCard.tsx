// The AI movie in the Export panel: the finished film's scenes go to Fal as reference frames and come back as one clip.
// Nothing is spent until the owner presses the button, which names the cost.
import { useEffect, useRef, useState } from 'react';
import { AI_VIDEO_RESOLUTIONS, type AiVideoJob, type AiVideoQuote, type AiVideoResolution } from '@shared/api';
import { AiVideoError, fetchAiVideoQuote, pollAiVideo, startAiVideo } from '../export/aiVideo';
import { exportFileName } from '../export/formats';
import { openSettings } from '../settings/access';

export interface AiMovieDeps {
  fetchQuote?: typeof fetchAiVideoQuote;
  start?: typeof startAiVideo;
  poll?: typeof pollAiVideo;
  openSettings?: () => void;
  now?: () => Date;
}

type Quotes = Partial<Record<AiVideoResolution, AiVideoQuote>>;
type Run =
  | { kind: 'idle' }
  | { kind: 'sending'; frames: number }
  | { kind: 'waiting'; job: AiVideoJob }
  | { kind: 'done'; job: AiVideoJob }
  | { kind: 'error'; message: string };

const LABELS: Record<AiVideoResolution, { name: string; note: string }> = {
  '480P': { name: 'Draft', note: '480p · cheapest, to check the idea' },
  '768P': { name: 'Standard', note: '768p · sharper, for sharing' },
};

const usd = (n: number): string => `$${n.toFixed(2)}`;
const clock = (sec: number): string => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

export default function AiMovieCard({ filmId, title, hasContent, deps = {} }: { filmId?: string; title?: string; hasContent: boolean; deps?: AiMovieDeps }) {
  const fetchQuote = deps.fetchQuote ?? fetchAiVideoQuote;
  const start = deps.start ?? startAiVideo;
  const poll = deps.poll ?? pollAiVideo;
  const settings = deps.openSettings ?? openSettings;
  const now = deps.now ?? (() => new Date());
  const [resolution, setResolution] = useState<AiVideoResolution>('480P');
  const [quotes, setQuotes] = useState<Quotes>({});
  const [quoteError, setQuoteError] = useState('');
  const [run, setRun] = useState<Run>({ kind: 'idle' });
  const [elapsed, setElapsed] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const startedAt = useRef(0);
  const ready = filmId !== undefined && hasContent;

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const load = () => {
      void Promise.all(AI_VIDEO_RESOLUTIONS.map((r) => fetchQuote(filmId, r)))
        .then((all) => {
          if (!alive) return;
          setQuotes(Object.fromEntries(all.map((q) => [q.resolution, q])));
          setQuoteError('');
        })
        .catch((e: unknown) => {
          if (alive) setQuoteError(e instanceof Error ? e.message : 'The AI movie is not available right now.');
        });
    };
    load();
    // saving a key in Settings should light the button without a reload
    window.addEventListener('director-access', load);
    return () => {
      alive = false;
      window.removeEventListener('director-access', load);
    };
  }, [filmId, ready]);

  useEffect(() => {
    if (run.kind !== 'waiting') return;
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [run.kind]);

  useEffect(() => () => abort.current?.abort(), []);

  const quote = quotes[resolution];

  async function make() {
    if (!filmId || !quote) return;
    const ctl = new AbortController();
    abort.current = ctl;
    setRun({ kind: 'sending', frames: quote.frames });
    try {
      const job = await start(filmId, resolution);
      startedAt.current = Date.now();
      setRun({ kind: 'waiting', job });
      const last = await poll(job.id, { signal: ctl.signal, onView: (v) => setRun({ kind: 'waiting', job: v }) });
      setRun(last.status === 'succeeded' ? { kind: 'done', job: last } : { kind: 'error', message: last.error ?? 'The AI movie failed.' });
    } catch (e) {
      if (e instanceof AiVideoError && e.code === 'aborted') return;
      setRun({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }
  function stopWaiting() {
    abort.current?.abort();
    setRun({ kind: 'idle' });
  }

  return (
    <section className="ai-card" aria-label="AI movie">
      <div className="ai-head">
        <h3>Turn it into a movie with AI</h3>
        <p className="ai-lede">Your scenes become reference frames, and MiniMax H3 films them as one clip.</p>
      </div>

      {run.kind === 'idle' && (
        <>
          {!ready && <p className="ai-note">Nothing to make a movie from yet.</p>}
          {ready && quoteError && <p className="ai-note">{quoteError}</p>}
          {ready && !quoteError && !quote && <p className="ai-note" role="status">Checking the cost…</p>}
          {ready && quote && (
            <>
              <div role="radiogroup" aria-label="AI movie quality" className="ai-options">
                {AI_VIDEO_RESOLUTIONS.map((r) => (
                  <button key={r} type="button" role="radio" aria-checked={resolution === r} className="ai-option" onClick={() => setResolution(r)}>
                    <span className="ai-option-name">{LABELS[r].name}</span>
                    <span className="ai-option-price">{quotes[r] ? usd(quotes[r]!.costUsd) : '…'}</span>
                    <span className="ai-option-note">{LABELS[r].note}</span>
                  </button>
                ))}
              </div>
              <ul className="ai-facts">
                <li>{quote.durationSec} s clip{quote.filmSec > quote.durationSec ? ` (your ${quote.filmSec} s film, cut to fit)` : ''}</li>
                <li>{quote.frames} reference {quote.frames === 1 ? 'frame' : 'frames'}</li>
                <li>Usually a few minutes</li>
              </ul>
              {quote.skippedScenes.length > 0 && <p className="ai-note">Left out, with no picture to film from: {quote.skippedScenes.join(', ')}.</p>}
              {quote.keyReady ? (
                <button type="button" className="primary" onClick={() => void make()}>
                  Make AI movie · {usd(quote.costUsd)} →
                </button>
              ) : (
                <div className="ai-key">
                  <p>An AI movie is optional and runs on your own Fal key, which stays on this browser session and network.</p>
                  <button type="button" className="primary" onClick={settings}>Add your Fal key</button>
                </div>
              )}
              <p className="ai-fine">Fal bills your account only when you press the button. The AI clip carries no text, because video models garble lettering.</p>
            </>
          )}
        </>
      )}

      {(run.kind === 'sending' || run.kind === 'waiting') && (
        <div className="ai-run" role="status" aria-live="polite">
          <p className="ai-run-title">
            {run.kind === 'sending' && `Sending ${run.frames} ${run.frames === 1 ? 'frame' : 'frames'} to Fal…`}
            {run.kind === 'waiting' && run.job.status === 'queued' && (run.job.queuePosition !== undefined ? `In Fal's queue · position ${run.job.queuePosition}` : "In Fal's queue…")}
            {run.kind === 'waiting' && run.job.status === 'running' && 'Fal is filming your movie…'}
          </p>
          <div className="export-progress ai-indeterminate" role="progressbar" aria-label="AI movie progress"><span /></div>
          {run.kind === 'waiting' && (
            <>
              <p className="ai-fine">{clock(elapsed)} · {run.job.durationSec} s clip · {usd(run.job.costUsd)}. Keep this tab open.</p>
              <button type="button" onClick={stopWaiting}>Stop waiting</button>
              <p className="ai-fine">Stopping only stops watching: the run continues on Fal and is still billed.</p>
            </>
          )}
        </div>
      )}

      {run.kind === 'done' && run.job.videoUrl && (
        <div className="ai-done">
          <video className="ai-video" src={run.job.videoUrl} controls playsInline preload="metadata" aria-label="Your AI movie" />
          <div className="ai-done-side">
            <p className="ai-done-title">Your AI movie is ready</p>
            <p className="ai-fine">{run.job.durationSec} s · {usd(run.job.costUsd)} billed by Fal.</p>
            <div className="ai-done-row">
              <a className="ai-download" href={run.job.videoUrl} download={exportFileName(`${title ?? 'film'} ai`, 'mp4', now())}>Download MP4</a>
              <button type="button" onClick={() => setRun({ kind: 'idle' })}>Make another</button>
            </div>
          </div>
        </div>
      )}

      {run.kind === 'error' && (
        <div role="alert" className="ai-error">
          <p>{run.message}</p>
          <button type="button" onClick={() => setRun({ kind: 'idle' })}>Try again</button>
        </div>
      )}
    </section>
  );
}
