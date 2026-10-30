import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import type { AepCompositionJson } from 'reacthub-pixitweenjs';
import type { Aspect, FilmId } from '@shared/composition';
import type { FilmEvent } from '@shared/events';
import type { ToolCtx } from '@shared/tools';
import { lightValidator } from '../engine/validate';
import { createEventBus } from '../events/bus';
import { emitStamped, makeToolCtx } from '../http/deps';
import { createLedger } from '../ledger';
import { makeFakeMeta } from '../meta/fakes';
import { createAssetStore } from '../store/asset-store';
import { createFilmStore } from '../store/film-store';

/** Temp-dir stores, FakeMeta, a ledger, and a ctx whose emitted events are collected into `events` (after the bus appends them). */
export async function makeTestFilm(o: { aspect?: Aspect; composition?: AepCompositionJson } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'testfilm-'));
  const bus = createEventBus(dir);
  const assets = createAssetStore({ dir, publicBaseUrl: 'http://localhost:8787' });
  const films = createFilmStore({ dir, validator: lightValidator });
  const meta = makeFakeMeta();
  const ledger = createLedger({ dir, emit: (id, e) => emitStamped(bus, id, e) });

  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#cccccc' } }).png().toBuffer();
  const product = await assets.put(png, 'image/png', { role: 'product-photo' });
  const film = await films.create({ aspect: o.aspect ?? '16:9', brief: { text: 'test brief', productAssetId: product.id }, assets: [product] });
  const filmId: FilmId = film.id;

  const events: FilmEvent[] = [];
  bus.subscribe(filmId, (env) => events.push(env.event), { internal: true });
  const ctx: ToolCtx = makeToolCtx({ films, assets, meta, ledger, bus }, filmId);
  if (o.composition) await films.commit(filmId, o.composition, 'user');
  return { filmId, films, assets, ctx, events, meta, ledger, bus, dir };
}
