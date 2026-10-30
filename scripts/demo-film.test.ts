import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { filmEventSchema } from '../shared/events';
import { lightValidator } from '../server/engine/validate';
import { createEventBus } from '../server/events/bus';
import { createAssetStore } from '../server/store/asset-store';
import { createFilmStore } from '../server/store/film-store';
import { demoEvents, loadDemoFilm, redact } from './demo-film';

it('the fixture log has a user storyboard edit, three takes and a ready film', () => {
  const events = demoEvents().map((e) => filmEventSchema.parse(e));
  expect(events.some((e) => e.type === 'storyboard.revised' && e.source === 'user')).toBe(true);
  expect(events.filter((e) => e.type === 'take.ready')).toHaveLength(3);
  expect(events.filter((e) => e.type === 'film.status').at(-1)).toMatchObject({ status: 'ready' });
});

it('loads into a temp DATA_DIR: the film is listed with crew true, with its versions, its log and its photo', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'demo-film-'));
  const id = loadDemoFilm(dir);
  const films = createFilmStore({ dir, validator: lightValidator });
  const listed = await films.list();
  expect(listed).toHaveLength(1);
  expect(listed[0]).toMatchObject({ id, crew: true, status: 'ready', title: 'Morning Ritual' });
  const versions = await films.versions(id);
  expect(versions.length).toBeGreaterThan(1);
  const log = await createEventBus(dir).replay(id);
  expect(log.map((e) => e.event)).toEqual(demoEvents());
  const assets = createAssetStore({ dir, publicBaseUrl: 'http://localhost:8787' });
  expect((await assets.read(listed[0]!.brief.productAssetId)).length).toBeGreaterThan(100);
});

it('holds no secret and no long data: URL', () => {
  const text = JSON.stringify(demoEvents());
  expect(text).not.toMatch(/authorization|passcode|api[_-]?key|bearer/i);
  expect(text).not.toMatch(/data:[a-z/]+;base64,[A-Za-z0-9+/=]{200,}/);
});

it('redact blanks credentials and long data URLs and leaves the rest alone', () => {
  expect(redact('{"Authorization":"Bearer abc","a":1}')).toBe('{"Authorization":"[redacted]","a":1}');
  expect(redact(`x data:image/png;base64,${'A'.repeat(300)} y`)).toBe('x data:redacted y');
  expect(redact('{"a":"data:image/png;base64,AAAA"}')).toBe('{"a":"data:image/png;base64,AAAA"}');
});
