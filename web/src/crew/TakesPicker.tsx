// Owned by S12d. Takes A, B and C of a scene side by side, scored by the critic. One click puts a take in the film.
import { useState } from 'react';
import type { CrewState } from './crewReducer';

export function TakesPicker({ crew, onPick }: { crew: CrewState; onPick(jobId: string, takeFilmId: string): Promise<unknown> | void }) {
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const groups = Object.entries(crew.takes).filter(([, t]) => t.length > 0);
  if (!groups.length) return null;
  const pick = async (jobId: string, takeFilmId: string) => {
    setError('');
    try {
      await onPick(jobId, takeFilmId);
      setPicked((p) => ({ ...p, [jobId]: takeFilmId }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The pick was refused.');
    }
  };
  return (
    <section className="takes" aria-label="Takes">
      {groups.map(([jobId, takes]) => {
        const best = Math.max(...takes.map((t) => t.score ?? -Infinity));
        return (
          <div key={jobId} className="take-group">
            <h3>Takes of {takes[0]!.sceneId}</h3>
            <div className="take-row">
              {takes.map((t) => {
                const isBest = t.score !== undefined && t.score === best;
                const inFilm = picked[jobId] === t.takeFilmId;
                return (
                  <figure key={t.label} className={`take${isBest ? ' is-best' : ''}${inFilm ? ' is-picked' : ''}`}>
                    {t.thumbAssetId ? <img src={`/api/assets/${t.thumbAssetId}`} alt={`Take ${t.label}`} loading="lazy" /> : <div className="take-blank" aria-hidden="true">{t.label}</div>}
                    <figcaption>
                      <span className="take-label">Take {t.label}</span>
                      {t.score !== undefined && <span className="take-score">{t.score}/10</span>}
                      {isBest && <span className="badge">critic's pick</span>}
                      {inFilm ? <span className="in-film">in the film</span> : <button type="button" className="primary" onClick={() => void pick(jobId, t.takeFilmId)}>Pick</button>}
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          </div>
        );
      })}
      {error && <p role="alert" className="crew-error">{error}</p>}
    </section>
  );
}
