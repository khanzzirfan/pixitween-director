import { isAnimated, type Kf } from './keyframes';
import { readDirector, sceneIds } from './meta';
import type { Comp, Obj } from './types';

const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const sec = (frames: number, fps: number) => (frames / fps).toFixed(1);
const first = <T>(f: T | Kf<T>[]): T => (isAnimated(f) ? (f as Kf<T>[])[0]!.v : (f as T));

function aspectOf(w: number, h: number): string {
  const r = w / h;
  if (Math.abs(r - 16 / 9) < 0.02) return '16:9';
  if (Math.abs(r - 9 / 16) < 0.02) return '9:16';
  if (Math.abs(r - 1) < 0.02) return '1:1';
  return `${w}:${h}`;
}

/**
 * Compact deterministic text view for agent prompts (design 5.7). Rules the code settles where the design example is silent:
 * shapes show their fill but no position or scale (they fill their box); images and video show `at` and `scale`;
 * text shows `at` and `size`; `anim:` lists keyframed position, scale, rotation, opacity in that order.
 */
export function summariseComposition(c: Comp): string {
  const meta = readDirector(c);
  const ids = sceneIds(c);
  const n = ids.length;
  const head = `film "${c.name ?? c.id}" ${aspectOf(c.width, c.height)} ${c.width}x${c.height} @${c.fps}fps ${sec(c.durationInFrames - (n ? 0 : 1), c.fps)}s, ${n ? `${n} ${n === 1 ? 'scene' : 'scenes'}` : 'no scenes yet'}`;
  if (!n) return head.replace(/ [\d.]+s,/, ' 0.0s,');

  const lines = [head];
  for (const id of ids) {
    const sm = meta.scenes[id]!;
    const cam = sm.camera ? ` camera=${sm.camera.move}` : '';
    const intent = sm.intent ? ` "${trunc(sm.intent, 60)}"` : '';
    lines.push(`scene ${id} ${sec(sm.startFrame, c.fps)}-${sec(sm.startFrame + sm.durationFrames, c.fps)}s ${sm.mode}${cam}${intent}`);
    for (const l of ((c.precomps as Record<string, Obj>)[id]?.layers ?? []) as Obj[]) {
      const lm = meta.layers[l.id];
      const t = l.transform as Obj;
      const parts = [l.id, l.kind];
      if (l.kind === 'shape') parts.push(String(first(l.fill ?? '')));
      else if (l.kind === 'image' || l.kind === 'video') parts.push(l.assetId);
      else if (l.kind === 'text') parts.push(`"${trunc(String(first(l.source)), 40)}"`);
      parts.push(`z${lm?.z ?? 0}`);
      if (l.kind !== 'shape') {
        const p = first<[number, number]>(t.position);
        parts.push(`at ${Math.round(p[0])},${Math.round(p[1])}`);
      }
      if (l.kind === 'image' || l.kind === 'video') parts.push(`scale ${first<[number, number]>(t.scale)[0].toFixed(2)}`);
      if (l.kind === 'text') parts.push(`size ${first<number>(l.style.size)}`);
      const anim = ['position', 'scale', 'rotation', 'opacity'].filter((f) => isAnimated(t[f]));
      if (anim.length) parts.push(`anim:${anim.join(',')}`);
      if (lm?.placeholder) parts.push('[placeholder]');
      lines.push(`  ${parts.join(' ')}`);
    }
  }
  return lines.join('\n');
}
