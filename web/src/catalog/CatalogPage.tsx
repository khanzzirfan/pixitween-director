// Owned by Catalog Crew C1 (US-011). The catalog page: the wall of products on one side and one
// Player on the stage, so the owner can watch a catalog being made and check any one clip.
// Only one Player is ever mounted: the WebGL context is a limited resource.
import { useEffect, useMemo, useState } from 'react';
import type { AepCompositionJson } from '@shared/aep';
import { isFinal } from '@shared/catalog-run';
import Player from '../player/Player';
import { Slot } from '../shell/Slot';
import { StudioShell } from '../shell/StudioShell';
import { getClip, getHeroFilm, getLineFilm } from './api';
import CatalogWall from './CatalogWall';
import { useCatalog } from './useCatalog';

export interface CatalogPageProps {
  /** The run to show. */
  catalogId: string;
}

/** What the page says when the run cannot be read. */
function why(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'The catalog could not be read.';
}

/** The catalog page: the wall, and the player for the row that is picked. */
export default function CatalogPage({ catalogId }: CatalogPageProps) {
  const { run, rows, error, applyRow, reload } = useCatalog(catalogId);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedFilm, setSelectedFilm] = useState<string | null>(null);
  // a picked row plays its hero film when it has one, else its tile
  const [rowView, setRowView] = useState<'film' | 'tile'>('film');
  const films = useMemo(() => run?.films ?? [], [run]);
  const film = films.find((f) => f.id === selectedFilm) ?? null;
  const filmVersion = film?.version ?? null;
  const [clip, setClip] = useState<AepCompositionJson | null>(null);
  const [clipError, setClipError] = useState<string | null>(null);

  // The stage is never empty once something is done: the first product with a hero film plays it (Muse's film is the showcase),
  // else the first line film, else the first finished row's tile, until the owner picks one.
  const usable = (r: (typeof rows)[number]) => isFinal(r.status) && r.status !== 'failed';
  const firstHero = rows.find((r) => usable(r) && r.hero)?.product.id ?? null;
  const firstDone = rows.find(usable)?.product.id ?? null;
  const firstFilm = films[0]?.id ?? null;
  useEffect(() => {
    if (selected !== null || selectedFilm !== null) return;
    if (firstHero) setSelected(firstHero);
    else if (firstFilm) setSelectedFilm(firstFilm);
    else if (firstDone) setSelected(firstDone);
  }, [selected, selectedFilm, firstHero, firstDone, firstFilm]);

  const pickRow = (id: string) => {
    setSelectedFilm(null);
    setSelected(id);
  };
  const pickFilm = (id: string) => {
    setSelected(null);
    setSelectedFilm(id);
  };
  // a price edit recuts the line films that show the product, so the run (and their versions) is read again
  const onEdited = (row: Parameters<typeof applyRow>[0]) => {
    applyRow(row);
    reload();
  };

  const row = useMemo(() => rows.find((r) => r.product.id === selected) ?? null, [rows, selected]);
  const productId = row?.product.id ?? null;
  const version = row?.clipVersion ?? null;
  const heroVersion = rowView === 'film' ? (row?.hero?.version ?? null) : null;
  const status = row?.status ?? null;

  // The clip of the picked row: it is read again whenever the row's clip changes (a price edit
  // bumps the version), so the player never shows an old cut.
  useEffect(() => {
    if (selectedFilm) {
      let stale = false;
      getLineFilm(catalogId, selectedFilm).then(
        (c) => {
          if (stale) return;
          setClip(c);
          setClipError(null);
        },
        (e: unknown) => {
          if (stale) return;
          setClip(null);
          setClipError(why(e));
        },
      );
      return () => {
        stale = true;
      };
    }
    if (!productId || !status || !isFinal(status)) {
      setClip(null);
      setClipError(null);
      return;
    }
    let stale = false;
    (heroVersion !== null ? getHeroFilm(catalogId, productId) : getClip(catalogId, productId)).then(
      (c) => {
        if (stale) return;
        setClip(c);
        setClipError(null);
      },
      (e: unknown) => {
        if (stale) return;
        setClip(null);
        setClipError(why(e));
      },
    );
    return () => {
      stale = true;
    };
  }, [catalogId, productId, version, status, selectedFilm, filmVersion, heroVersion]);

  return (
    <StudioShell
      title={run ? `Catalog: ${run.rows.length} products` : 'Catalog'}
      steps={[]}
      step={-1}
      tabs={[]}
      defaultTab=""
      stage={
        <Slot name="player">
          <Player composition={clip} />
        </Slot>
      }
      side={
        <div className="catalog-side">
          {error ? (
            <p role="alert" className="catalog-error">
              {why(error)}
            </p>
          ) : null}
          {clipError && (
            <p role="alert" className="catalog-error">
              {clipError}
            </p>
          )}
          <CatalogWall
            rows={rows}
            costUsd={run?.costUsd ?? 0}
            selected={selected}
            onSelect={pickRow}
            catalogId={catalogId}
            onEdited={onEdited}
            films={films}
            selectedFilm={selectedFilm}
            onSelectFilm={pickFilm}
            rowView={rowView}
            onRowView={setRowView}
          />
        </div>
      }
      sideTitle="Catalog wall"
    />
  );
}
