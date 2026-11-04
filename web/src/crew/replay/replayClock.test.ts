import { expect, it } from 'vitest';
import type { FilmEvent } from '@shared/events';
import { countAt, schedule, totalMs } from './replayClock';

const at = (sec: number): FilmEvent => ({ filmId: 'f1', at: new Date(Date.UTC(2026, 9, 30, 14, 0, sec)).toISOString(), type: 'film.status', status: 'planning' });

it('schedules events at 0 s, 1 s and 21 s at speed 2 as 0, 500 and 1500 ms', () => {
  // the 20 s gap is squeezed to 2 s, then halved by the speed
  expect(schedule([at(0), at(1), at(21)], 2).map((s) => s.atMs)).toEqual([0, 500, 1500]);
});

it('keeps real time when the gap cap is off', () => {
  expect(schedule([at(0), at(1), at(21)], 2, Infinity).map((s) => s.atMs)).toEqual([0, 500, 10500]);
});

it('keeps log order when two events share a timestamp', () => {
  const a = { ...at(5), status: 'planning' } as FilmEvent;
  const b = { ...at(5), status: 'building' } as FilmEvent;
  const s = schedule([at(0), a, b], 1);
  expect(s.map((x) => x.index)).toEqual([0, 1, 2]);
  expect(s[1]!.atMs).toBe(s[2]!.atMs);
});

it('never goes backwards when the log has a stamp out of order', () => {
  const s = schedule([at(10), at(5), at(12)], 1);
  expect(s.map((x) => x.atMs)).toEqual([0, 0, 2000]);
});

it('counts events by time and totals the replay', () => {
  const s = schedule([at(0), at(1), at(3)], 1);
  expect(countAt(s, 999)).toBe(1);
  expect(countAt(s, 1000)).toBe(2);
  expect(totalMs(s)).toBe(3000);
  expect(totalMs([])).toBe(0);
});
