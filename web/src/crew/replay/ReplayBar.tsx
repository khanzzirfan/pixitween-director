// Owned by S12e. Transport for a replay: play or pause, restart, a scrubber, and the speed.
import { SPEEDS } from './replayClock';
import type { Replay } from './useReplay';

const clock = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function ReplayBar({ replay }: { replay: Replay }) {
  const { playing, done, speed, progress, durationMs } = replay;
  return (
    <div className="replay-bar" role="group" aria-label="Replay">
      <span className="replay-tag">REPLAY</span>
      <button type="button" className="replay-play" aria-label={playing ? 'Pause replay' : done ? 'Watch again' : 'Play replay'} onClick={playing ? replay.pause : replay.play}>
        {playing ? '❚❚' : done ? '↻' : '▶'}
      </button>
      <input
        type="range"
        className="replay-scrub"
        aria-label="Replay position"
        min={0}
        max={1000}
        value={Math.round(progress * 1000)}
        onChange={(e) => replay.seek(Number(e.target.value) / 1000)}
      />
      <span className="replay-time" aria-live="off">{clock(durationMs * progress)} / {clock(durationMs)}</span>
      <div className="replay-speeds" role="radiogroup" aria-label="Replay speed">
        {SPEEDS.map((s) => (
          <button key={s} type="button" role="radio" aria-checked={s === speed} className={s === speed ? 'on' : ''} onClick={() => replay.setSpeed(s)}>
            {s}×
          </button>
        ))}
      </div>
    </div>
  );
}
