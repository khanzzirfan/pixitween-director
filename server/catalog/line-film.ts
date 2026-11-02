// Owned by Catalog Crew C1. The line films of a run: the products of one line (one brand, else one category) cut together as
// one variant film (server/authoring/variant-film.ts, docs/direction/corpus/06-reference-films.md R1-R6): per product a colour
// field that whips in, a halo, the pack tumbling in tilted and settling, its name typed in word by word and a push into the
// label as the cut; then every product on one floor band with the tagline and the prices held. The row tiles are the editable
// unit; the line film is the showcase. Pure apart from the store: it reads the builds the rows were made from and pays nothing.
import { shownPrice } from '@shared/catalog';
import { isFinal, type CatalogRow, type CatalogRun, type LineFilm } from '@shared/catalog-run';
import { buildVariantFilm, colorFor, taglineFor, variantNames } from '../authoring/variant-film';
import type { RowBuild } from './row';
import type { RunStore } from './run-store';

/** The variant film plays at most this many acts; a bigger line is cut into films of this size. */
const MAX_PER_FILM = 6;
/** A variant's name on its act stays short enough to read in one look. */
const NAME_WORDS = 2;

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'line';

/** What a line is called: the brand, else the category. */
const lineKey = (row: CatalogRow): string => row.product.brand?.trim() || row.product.category;

/**
 * The lines of a run: the rows that ended with a clip, grouped by brand (else category), in the run's order. A line of one
 * product has nothing to cut between, so it gets no film; a line of more than six is cut into films of six.
 */
export function lineGroups(rows: readonly CatalogRow[]): Array<{ id: string; title: string; rows: CatalogRow[] }> {
  const byKey = new Map<string, CatalogRow[]>();
  for (const row of rows) {
    if (!isFinal(row.status) || row.status === 'failed') continue;
    const key = lineKey(row);
    byKey.set(key, [...(byKey.get(key) ?? []), row]);
  }
  const out: Array<{ id: string; title: string; rows: CatalogRow[] }> = [];
  const used = new Set<string>();
  for (const [title, group] of byKey) {
    for (let at = 0; at < group.length; at += MAX_PER_FILM) {
      const part = group.slice(at, at + MAX_PER_FILM);
      if (part.length < 2) continue;
      let id = `line-${slug(title)}${at ? `-${at / MAX_PER_FILM + 1}` : ''}`;
      for (let n = 2; used.has(id); n++) id = `line-${slug(title)}-${n}`;
      used.add(id);
      out.push({ id, title, rows: part });
    }
  }
  return out;
}

/**
 * A variant name short enough for its act: the words its title does not share with the line, at most two. The last words
 * are kept, because a title ends on what the thing is ("Sun Stripe Beach Towel" is "Beach Towel").
 */
export const shortNames = (titles: string[]): string[] => variantNames(titles).map((n) => n.split(/\s+/).slice(-NAME_WORDS).join(' '));

/**
 * Builds and saves the line films of a run from the builds its rows were made from, and returns what the run should list.
 * A row whose build is gone is left out of its line; a line left with fewer than two products gets no film. With `only`
 * (a price edit), a line that does not hold that product and already has its film keeps it as it is.
 */
export async function buildLineFilms(run: CatalogRun, store: RunStore, only?: string): Promise<LineFilm[]> {
  const films: LineFilm[] = [];
  for (const group of lineGroups(run.rows)) {
    const kept = run.films?.find((f) => f.id === group.id);
    if (only && kept && !group.rows.some((r) => r.product.id === only)) {
      films.push(kept);
      continue;
    }
    const parts: Array<{ row: CatalogRow; build: RowBuild }> = [];
    for (const row of group.rows) {
      const build = await store.readBuild<RowBuild>(run.id, row.product.id);
      if (build?.product?.id) parts.push({ row, build });
    }
    if (parts.length < 2) continue;
    const titles = parts.map((p) => p.row.product.title);
    const names = shortNames(titles);
    const brand = parts[0]!.row.product.brand;
    const tagline = taglineFor(titles, brand);
    const comp = buildVariantFilm({
      aspect: run.aspect,
      brand: brand ?? group.title,
      tagline,
      accent: parts[0]!.build.accent,
      variants: parts.map(({ row, build }, n) => ({
        product: build.product,
        name: names[n]!,
        color: colorFor(names[n]!, n),
        price: shownPrice(row.product),
        ...(row.product.salePrice !== undefined ? { wasPrice: row.product.price } : {}),
        ...(row.product.currency ? { currency: row.product.currency } : {}),
      })),
    });
    await store.saveFilm(run.id, group.id, comp);
    const before = run.films?.find((f) => f.id === group.id);
    films.push({ id: group.id, title: group.title, tagline, productIds: parts.map((p) => p.row.product.id), version: (before?.version ?? 0) + 1 });
  }
  return films;
}
