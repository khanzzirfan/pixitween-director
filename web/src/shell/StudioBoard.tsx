// The board: one read-only summary for every studio screen, in the order a person thinks — products, story, shots, crew.
// It has no forms and starts no work; pointing at a product or a shot puts a reference into the chat.
import '../intake/intake.css';

export type BoardState = 'done' | 'working' | 'waiting' | 'failed';
export interface BoardProduct {
  id: string;
  title: string;
  price?: string;
  /** a short warning, e.g. "needs a photo" */
  note?: string;
}
export interface BoardShot {
  id: string;
  title: string;
  state: BoardState;
}

export interface StudioBoardProps {
  products: BoardProduct[];
  story: string;
  shots: BoardShot[];
  /** one line per member who is busy, e.g. "Builder on shot 4" */
  crew: string[];
  onPoint?(ref: string): void;
}

const MARK: Record<BoardState, string> = { done: '✓', working: '◌', waiting: '○', failed: '✕' };

export function StudioBoard({ products, story, shots, crew, onPoint }: StudioBoardProps) {
  const done = shots.filter((s) => s.state === 'done').length;
  const point = (ref: string) => onPoint?.(ref);
  return (
    <div className="board" data-testid="studio-board">
      <section className="board-card" aria-label="Products">
        <h3>Products{products.length ? ` · ${products.length}` : ''}</h3>
        {products.length ? (
          <ul>
            {products.map((p) => (
              <li key={p.id}>
                <button type="button" className="board-point" title="Refer to this in the chat" disabled={!onPoint} onClick={() => point(p.title)}>
                  <span>{p.title}</span>
                  {p.price && <small>{p.price}</small>}
                  {p.note && <em className="board-missing">{p.note}</em>}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="board-empty">Drop photos or a CSV in the chat.</p>
        )}
      </section>
      <section className="board-card" aria-label="Story">
        <h3>Story</h3>
        <p className={story.trim() ? '' : 'board-empty'}>{story.trim() || 'Your brief will show here.'}</p>
      </section>
      <section className="board-card" aria-label="Shots">
        <h3>Shots{shots.length ? ` · ${done} of ${shots.length}` : ''}</h3>
        {shots.length ? (
          <ul>
            {shots.map((s, i) => (
              <li key={s.id} className={`board-shot is-${s.state}`}>
                <button type="button" className="board-point" disabled={!onPoint} onClick={() => point(`Shot ${i + 1}: ${s.title}`)}>
                  <span aria-hidden="true">{MARK[s.state]}</span>
                  <span>{s.title}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="board-empty">They appear here once the film is planned.</p>
        )}
      </section>
      <section className="board-card" aria-label="Crew">
        <h3>Crew</h3>
        {crew.length ? crew.map((line) => <p key={line}>{line}</p>) : <p className="board-empty">Waiting for work.</p>}
      </section>
    </div>
  );
}
