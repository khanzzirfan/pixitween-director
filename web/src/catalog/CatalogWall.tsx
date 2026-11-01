// Owned by Catalog Crew C1 (US-011). The wall: every product of the run as a row, with its status
// and check chips, so the owner can watch the whole catalog being made and checked at a glance.
// The wall draws; it decides nothing. What a row means is the server's own check (see `chips.ts`).
import { useEffect, useRef, useState } from 'react';
import { formatPrice, shownPrice } from '@shared/catalog';
import { isFinal, summarize, type CatalogRow, type CatalogSummary } from '@shared/catalog-run';
import { editProduct, type ProductEdit } from './api';
import { checkChip, statusChip } from './chips';
import './catalog.css';

/** How long "updated in 140 ms" stays on the row. */
const NOTICE_MS = 5000;
const PRICE_HINT = 'Enter a price like 19.00';

/** A typed price as a number; undefined when it is not a price the shop could print. */
function readPrice(text: string): number | undefined {
  const t = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return undefined;
  return Number(t);
}

export interface CatalogWallProps {
  /** The run's rows, in the run's order. */
  rows: CatalogRow[];
  /** The counts of the header line; counted from the rows when they are not given. */
  summary?: CatalogSummary;
  /** What the run has cost so far, in dollars. */
  costUsd?: number;
  /** The product id of the row that is on the stage. */
  selected?: string | null;
  /** Called with the product id of the row the owner clicked. */
  onSelect?: (productId: string) => void;
  /** The run the rows belong to; a price can be edited on the wall only when it is given. */
  catalogId?: string;
  /** Called with the row the server answered a price edit with. */
  onEdited?: (row: CatalogRow) => void;
}

/** The price editor of the row on the stage: one price, or an old price and a sale price. */
function PriceEditor({ row, catalogId, onEdited }: { row: CatalogRow; catalogId: string; onEdited?: (row: CatalogRow) => void }) {
  const product = row.product;
  const onSale = product.salePrice !== undefined;
  const [sale, setSale] = useState(onSale);
  const [price, setPrice] = useState(shownPrice(product).toFixed(2));
  const [was, setWas] = useState(product.price.toFixed(2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // The row changes under the editor when an answer or an event lands: show what the row now says.
  const shown = shownPrice(product);
  useEffect(() => {
    setPrice(shown.toFixed(2));
    setWas(product.price.toFixed(2));
    setSale(product.salePrice !== undefined);
  }, [shown, product.price, product.salePrice]);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function save() {
    if (busy) return;
    const next = readPrice(price);
    const old = sale ? readPrice(was) : undefined;
    if (next === undefined || (sale && old === undefined)) {
      setError(PRICE_HINT);
      return;
    }
    if (sale && old !== undefined && next >= old) {
      setError('The sale price must be lower than the old price');
      return;
    }
    setError(null);
    // On sale the old price is the price and the typed one is the sale price; off sale the sale goes.
    const body: ProductEdit = sale ? { price: old, salePrice: next } : { price: next, salePrice: null };
    setBusy(true);
    try {
      const { row: updated } = await editProduct(catalogId, product.id, body);
      onEdited?.(updated);
      setNotice(`updated in ${updated.ms ?? 0} ms · $0.00`);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setNotice(null), NOTICE_MS);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The price could not be changed.');
    } finally {
      setBusy(false);
    }
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void save();
    }
  };

  return (
    <div className="catalog-edit" data-edit={product.id}>
      <label className="catalog-edit-field">
        <span>{sale ? 'Sale price' : 'Price'}</span>
        <input aria-label={`Price of ${product.title}`} inputMode="decimal" value={price} disabled={busy} onChange={(e) => setPrice(e.target.value)} onKeyDown={onKey} />
      </label>
      <label className="catalog-edit-sale">
        <input type="checkbox" checked={sale} disabled={busy} onChange={(e) => setSale(e.target.checked)} />
        <span>on sale</span>
      </label>
      {sale && (
        <label className="catalog-edit-field">
          <span>Old price</span>
          <input aria-label={`Old price of ${product.title}`} inputMode="decimal" value={was} disabled={busy} onChange={(e) => setWas(e.target.value)} onKeyDown={onKey} />
        </label>
      )}
      <button type="button" className="catalog-edit-save" disabled={busy} onClick={() => void save()}>
        Save
      </button>
      {busy && <span className="catalog-edit-note">Updating…</span>}
      {notice && !busy && <span className="catalog-edit-note is-done">{notice}</span>}
      {error && (
        <p role="alert" className="catalog-edit-error">
          {error}
        </p>
      )}
    </div>
  );
}

/** One row: the product, the look it was built with, and the two chips. */
function CatalogRowView({
  row,
  selected,
  onSelect,
  catalogId,
  onEdited,
}: {
  row: CatalogRow;
  selected: boolean;
  onSelect?: (id: string) => void;
  catalogId?: string;
  onEdited?: (row: CatalogRow) => void;
}) {
  const product = row.product;
  const final = isFinal(row.status);
  const status = statusChip(row);
  const check = checkChip(row);
  return (
    <li className={`catalog-row${selected ? ' is-on' : ''}`} data-row={product.id}>
      <button
        type="button"
        className="catalog-row-btn"
        onClick={() => onSelect?.(product.id)}
        disabled={!final}
        aria-pressed={selected}
        title={final ? `Play ${product.title}` : `${product.title} is still ${row.status}`}
      >
        <span className="catalog-title">{product.title}</span>
        <span className="catalog-price">
          {formatPrice(shownPrice(product), product.currency)}
          {product.salePrice !== undefined && <s className="catalog-was">{formatPrice(product.price, product.currency)}</s>}
        </span>
        {row.look && <span className="catalog-look">{row.look}</span>}
        <span className={`catalog-status st-${row.status}${status.spinning ? ' is-spinning' : ''}`}>{status.text}</span>
        <span className={`catalog-check tone-${check.tone}`} data-tone={check.tone}>
          {check.text}
        </span>
      </button>
      {selected && catalogId && final && row.status !== 'failed' && <PriceEditor row={row} catalogId={catalogId} onEdited={onEdited} />}
    </li>
  );
}

/** The catalog wall: the header line with the counts, then one row per product. */
export default function CatalogWall({ rows, summary, costUsd = 0, selected, onSelect, catalogId, onEdited }: CatalogWallProps) {
  const counts = summary ?? summarize(rows);
  return (
    <section className="catalog-wall" aria-label="Catalog wall">
      <p className="catalog-head" data-testid="catalog-head">
        {`${counts.final}/${counts.total} done · ${counts.ready} ready · ${counts.fixed} fixed · ${counts.flagged} flagged`}
        <span className="catalog-sep">{' · '}</span>
        <span className="catalog-cost">{`$${costUsd.toFixed(2)}`}</span>
      </p>
      <ul className="catalog-rows">
        {rows.map((row) => (
          <CatalogRowView
            key={row.product.id}
            row={row}
            selected={selected === row.product.id}
            onSelect={onSelect}
            catalogId={catalogId}
            onEdited={onEdited}
          />
        ))}
      </ul>
    </section>
  );
}
