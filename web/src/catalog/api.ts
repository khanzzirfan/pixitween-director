// Owned by Catalog Crew C1 (US-009). The catalog client: the studio's typed way to start a run,
// read it, list the runs, hand a clip back and edit a price. The shape of a run is
// `shared/catalog-run.ts`, never a local guess, so every catalog view reads the same state.
import type { AepCompositionJson } from '@shared/aep';
import type { CatalogRow, CatalogRun } from '@shared/catalog-run';
import { ApiRequestError, request } from '../api/client';

/** What an import answers: the run's id and the carrier film's id. */
export interface CatalogImportResult {
  catalogId: string;
  filmId: string;
}

/** One line of the run list: how far the run got, without its rows. */
export interface CatalogListEntry {
  id: string;
  filmId: string;
  createdAt: string;
  state: 'running' | 'done';
  total: number;
  final: number;
}

export interface CatalogList {
  runs: CatalogListEntry[];
}

/** What a price edit may change. `salePrice: null` takes the sale off. */
export interface ProductEdit {
  price?: number;
  salePrice?: number | null;
  title?: string;
}

/** What an edit answers: the row as it is after the rebuild. */
export interface CatalogEditResult {
  row: CatalogRow;
}

/**
 * A refused catalog call. The message is the server's own error code on the first line, then the
 * server's detail and the feed's errors, one per line, so a caller can show them as they are.
 */
export class CatalogError extends Error {
  /** The HTTP status the server answered. */
  readonly status: number;
  /** The server's error code, e.g. `bad_feed` or `not_ready`. */
  readonly code: string;
  /** The feed's own errors, when the server sent them (`bad_feed`). */
  readonly errors: string[];

  constructor(status: number, code: string, errors: string[] = [], detail = '') {
    super([code, detail, ...errors].filter(Boolean).join('\n'));
    this.name = 'CatalogError';
    this.status = status;
    this.code = code;
    this.errors = errors;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The server's own answer, read into the parts the wall shows. */
function toCatalogError(status: number, body: unknown): CatalogError {
  const record = isRecord(body) ? body : {};
  const code = typeof record.error === 'string' && record.error ? record.error : `http_${status}`;
  const errors = Array.isArray(record.errors) ? record.errors.filter((e): e is string => typeof e === 'string') : [];
  const detail = typeof record.message === 'string' ? record.message : '';
  return new CatalogError(status, code, errors, detail);
}

/** The shared request, with the server's refusal turned into an error that names the reason. */
async function catalogRequest<T>(method: string, path: string, body?: BodyInit | null, json = false): Promise<T> {
  try {
    return await request<T>(method, path, body, json);
  } catch (err) {
    if (err instanceof ApiRequestError) throw toCatalogError(err.status, err.body);
    throw err;
  }
}

const enc = encodeURIComponent;

/** Starts a run from a feed (a CSV file or the demo feed) and the photos that go with it. */
export function importCatalog(form: FormData): Promise<CatalogImportResult> {
  return catalogRequest<CatalogImportResult>('POST', '/api/catalogs', form);
}

/** The run itself, with every row as the server has it. */
export function getCatalog(id: string): Promise<CatalogRun> {
  return catalogRequest<CatalogRun>('GET', `/api/catalogs/${enc(id)}`);
}

/** The runs, newest first. */
export function listCatalogs(): Promise<CatalogList> {
  return catalogRequest<CatalogList>('GET', '/api/catalogs');
}

/** One row's clip: the composition the player shows. */
export function getClip(id: string, productId: string): Promise<AepCompositionJson> {
  return catalogRequest<AepCompositionJson>('GET', `/api/catalogs/${enc(id)}/clips/${enc(productId)}`);
}

/** A product's hero film: Muse's board for it, played over its cut-out. */
export function getHeroFilm(id: string, productId: string): Promise<AepCompositionJson> {
  return catalogRequest<AepCompositionJson>('GET', `/api/catalogs/${enc(id)}/heroes/${enc(productId)}`);
}

/** A line film: the products of one line cut together, the run's showcase. */
export function getLineFilm(id: string, lineId: string): Promise<AepCompositionJson> {
  return catalogRequest<AepCompositionJson>('GET', `/api/catalogs/${enc(id)}/films/${enc(lineId)}`);
}

/** A price edit: the clip is rebuilt from what the run already paid for, so it costs nothing. */
export function editProduct(id: string, productId: string, body: ProductEdit): Promise<CatalogEditResult> {
  return catalogRequest<CatalogEditResult>(
    'PATCH',
    `/api/catalogs/${enc(id)}/products/${enc(productId)}`,
    JSON.stringify(body),
    true,
  );
}
