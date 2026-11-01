import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CatalogError, editProduct, getCatalog, getClip, importCatalog, listCatalogs } from './api';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const call = (n: number): [string, RequestInit] => fetchMock.mock.calls[n] as unknown as [string, RequestInit];

it('importCatalog posts the form and answers the run and the carrier film', async () => {
  fetchMock.mockResolvedValue(answer({ catalogId: 'cat_0123456789ab', filmId: 'film_0123456789ab' }, 202));
  await expect(importCatalog(new FormData())).resolves.toEqual({ catalogId: 'cat_0123456789ab', filmId: 'film_0123456789ab' });
  const [url, init] = call(0);
  expect(url).toBe('/api/catalogs');
  expect(init.method).toBe('POST');
  // the browser sets the multipart boundary itself, so no content type is sent
  expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
});

it('importCatalog rejects with an error that names the server code when the feed is refused', async () => {
  fetchMock.mockResolvedValue(answer({ error: 'bad_feed', errors: ['the feed header is missing: price, img, cat'] }, 400));
  const err = await importCatalog(new FormData()).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(Error);
  expect((err as Error).message).toContain('bad_feed');
  expect((err as Error).message).toContain('the feed header is missing: price, img, cat');
});

it('the refusal keeps the feed errors, one per line', async () => {
  fetchMock.mockResolvedValue(answer({ error: 'bad_feed', errors: ['first', 'second'] }, 400));
  const err = (await importCatalog(new FormData()).catch((e: unknown) => e)) as CatalogError;
  expect(err).toBeInstanceOf(CatalogError);
  expect(err.code).toBe('bad_feed');
  expect(err.status).toBe(400);
  expect(err.errors).toEqual(['first', 'second']);
  expect(err.message.split('\n')).toEqual(['bad_feed', 'first', 'second']);
});

it('a refusal without a code still names the status', async () => {
  fetchMock.mockResolvedValue(new Response('not json', { status: 500 }));
  const err = (await getCatalog('cat_0123456789ab').catch((e: unknown) => e)) as CatalogError;
  expect(err).toBeInstanceOf(CatalogError);
  expect(err.code).toBe('http_500');
});

it('getCatalog, getClip, editProduct and listCatalogs ask for their own routes', async () => {
  fetchMock.mockResolvedValue(answer({ id: 'cat_0123456789ab', rows: [] }));
  await getCatalog('cat_0123456789ab');
  expect(call(0)[0]).toBe('/api/catalogs/cat_0123456789ab');

  fetchMock.mockResolvedValue(answer({ fps: 30 }));
  await getClip('cat_0123456789ab', 'mug-stone');
  expect(call(1)[0]).toBe('/api/catalogs/cat_0123456789ab/clips/mug-stone');

  fetchMock.mockResolvedValue(answer({ row: { id: 'x' } }));
  await editProduct('cat_0123456789ab', 'mug-stone', { price: 21, salePrice: null });
  expect(call(2)[0]).toBe('/api/catalogs/cat_0123456789ab/products/mug-stone');
  expect(call(2)[1].method).toBe('PATCH');
  expect(call(2)[1].body).toBe('{"price":21,"salePrice":null}');
  expect((call(2)[1].headers as Record<string, string>)['Content-Type']).toBe('application/json');

  fetchMock.mockResolvedValue(answer({ runs: [] }));
  await listCatalogs();
  expect(call(3)[0]).toBe('/api/catalogs');
});
