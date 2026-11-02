// The line-up under the stage: one tab per product, in the order they are made. A tab opens that product's own film
// (its plan, crew, review and chat) in the same studio, so a catalogue reads exactly like one film.
import { currentItem, type ItemState, type Lineup } from '@shared/lineup';
import { openFilm } from '../shell/nav';
import './lineup.css';

const MARK: Record<ItemState, string> = { waiting: '○', making: '◌', done: '✓', failed: '!' };
const WORD: Record<ItemState, string> = { waiting: 'waiting', making: 'making now', done: 'done', failed: 'failed' };

export function LineupTabs({ lineup, filmId }: { lineup: Lineup; filmId: string | null }) {
  return (
    <div className="ln-tabs" role="tablist" aria-label="Products">
      {lineup.items.map((item, i) => {
        const on = !!item.filmId && item.filmId === filmId;
        return (
          <button
            key={item.product.id}
            type="button"
            role="tab"
            aria-selected={on}
            disabled={!item.filmId}
            title={item.error ?? `${item.product.title}: ${WORD[item.state]}`}
            className={`ln-tab is-${item.state}${on ? ' is-on' : ''}`}
            onClick={() => item.filmId && openFilm(item.filmId, lineup.id)}
          >
            <span className="ln-mark" aria-hidden="true">{MARK[item.state]}</span>
            <span className="ln-name">Product {i + 1}</span>
            <small>{item.product.title}</small>
          </button>
        );
      })}
    </div>
  );
}

/** One line above the chat: where the line-up is, so the owner always knows which product the crew is on. */
export function LineupNote({ lineup, filmId }: { lineup: Lineup; filmId: string | null }) {
  const now = currentItem(lineup);
  const at = lineup.items.findIndex((i) => i === now);
  const done = lineup.items.filter((i) => i.state === 'done').length;
  const failed = lineup.items.filter((i) => i.state === 'failed').length;
  const here = lineup.items.find((i) => i.filmId === filmId);
  const text = now
    ? `Making product ${at + 1} of ${lineup.items.length}: ${now.product.title}. ${done} done${failed ? `, ${failed} failed` : ''}.`
    : `All ${lineup.items.length} products are finished: ${done} done${failed ? `, ${failed} failed` : ''}.`;
  return (
    <div className="ln-note" role="status">
      <b>{text}</b>
      {here && here !== now && here.state === 'waiting' && <span> This one is waiting its turn.</span>}
      {here?.state === 'failed' && here.error && <span> {here.error}</span>}
      {now && here !== now && now.filmId && (
        <button type="button" className="ln-jump" onClick={() => openFilm(now.filmId!, lineup.id)}>Watch it</button>
      )}
    </div>
  );
}
