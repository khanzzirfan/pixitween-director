// Owned by Catalog Crew C1 (US-010). The studio's catalog panel: a CSV and the photos it names,
// or the demo feed, start a run. The run's own page is US-011; this panel starts it and opens it.
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CatalogError, importCatalog, listCatalogs, type CatalogListEntry } from './api';

type Aspect = '9:16' | '16:9' | '1:1';

/** The aspects a catalog may be cut for. The server takes the same three. */
const ASPECTS: readonly Aspect[] = ['9:16', '16:9', '1:1'];

/** The columns the feed has to carry. The server's parser is the judge, this is only the hint. */
const FEED_HEADER = 'id,title,price,sale_price,currency,image_link,category,link,brand';

/** The feed the studio can start from without a file of its own. */
const DEMO_FEED = 'feed-6';

/** How many recent runs the panel lists under the form. */
const RECENT_RUNS = 5;

/** Opens a catalog run: `?catalog=<id>`, the way the Gallery opens `?film=<id>`. */
function openCatalog(catalogId: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('catalog', catalogId);
  // a run brings its own carrier film, so the studio's own film is not the one on screen
  url.searchParams.delete('film');
  url.searchParams.delete('replay');
  window.history.pushState({}, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** What the panel shows when a call was refused: the reason, and the feed's own errors. */
interface PanelFailure {
  message: string;
  errors: string[];
}

/**
 * The refusal, in the panel's own shape. A `bad_feed` names its reasons in `errors`, so those go
 * down the panel as a list; every other refusal is one message.
 */
function toFailure(err: unknown): PanelFailure {
  if (err instanceof CatalogError) {
    return err.errors.length > 0 ? { message: err.code, errors: err.errors } : { message: err.message, errors: [] };
  }
  return { message: err instanceof Error ? err.message : 'The catalog could not be started.', errors: [] };
}

/** The catalog import panel: start a run from a feed, and open the runs that are already there. */
export default function CatalogImport() {
  const [csv, setCsv] = useState<File | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const [aspect, setAspect] = useState<Aspect>('9:16');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<PanelFailure | null>(null);
  const [runs, setRuns] = useState<CatalogListEntry[]>([]);

  const loadRuns = useCallback(() => {
    listCatalogs().then(
      (list) => setRuns(list.runs.slice(0, RECENT_RUNS)),
      () => setRuns([]),
    );
  }, []);

  useEffect(loadRuns, [loadRuns]);

  async function start(form: FormData): Promise<void> {
    setBusy(true);
    setFailure(null);
    try {
      const result = await importCatalog(form);
      openCatalog(result.catalogId);
      loadRuns();
    } catch (err) {
      setFailure(toFailure(err));
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent): void {
    e.preventDefault();
    if (busy) return;
    const form = new FormData();
    if (csv) form.set('csv', csv);
    for (const photo of photos) form.append('photos', photo, photo.name);
    form.set('aspect', aspect);
    void start(form);
  }

  function useDemo(): void {
    if (busy) return;
    const form = new FormData();
    form.set('demo', DEMO_FEED);
    form.set('aspect', aspect);
    void start(form);
  }

  return (
    <form className="classic-form" onSubmit={submit}>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">CATALOG</span>
          <h2>Build a catalog</h2>
        </div>
        <span className="step-pill">CSV · photos</span>
      </div>
      <p className="panel-intro">Drop in your product CSV and the photos it names, or start from the demo feed.</p>
      <label>
        Product CSV
        <input aria-label="Product CSV" type="file" accept=".csv" onChange={(e) => setCsv(e.target.files?.[0] ?? null)} />
      </label>
      <label>
        Photos
        <input
          aria-label="Photos"
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => setPhotos(Array.from(e.target.files ?? []))}
        />
      </label>
      <fieldset>
        <legend>Video format</legend>
        {ASPECTS.map((item) => (
          <label key={item}>
            <input type="radio" name="catalog-aspect" value={item} checked={aspect === item} onChange={() => setAspect(item)} />
            {item}
          </label>
        ))}
      </fieldset>
      <p className="composer-hint">
        Expected header: <code>{FEED_HEADER}</code>.{' '}
        <a href="/catalog/sample-feed.csv" download>
          Download a sample CSV
        </a>{' '}
        (its photos are in the repo, so it runs without uploads).
      </p>
      {failure && (
        <div role="alert">
          <p>{failure.message}</p>
          {failure.errors.length > 0 && (
            <ul>
              {failure.errors.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <button type="submit" disabled={busy}>
        {busy ? 'Starting your catalog…' : 'Build catalog'}
      </button>
      <button type="button" onClick={useDemo} disabled={busy}>
        Use demo feed (6 products)
      </button>
      {runs.length > 0 && (
        <div className="catalog-runs">
          <h3>Recent catalogs</h3>
          {runs.map((run) => (
            <button key={run.id} type="button" onClick={() => openCatalog(run.id)}>
              Catalog: {run.total} products · {run.state} · {run.final}/{run.total}
            </button>
          ))}
        </div>
      )}
    </form>
  );
}
