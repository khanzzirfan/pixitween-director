// Owned by Catalog Crew C1 (US-011). The catalog page: the wall of products on one side and one
// Player on the stage, so the owner can watch a catalog being made and check any one clip.
// Only one Player is ever mounted: the WebGL context is a limited resource.
import { useEffect, useMemo, useState } from 'react';
import type { AepCompositionJson } from '@shared/aep';
import { isFinal } from '@shared/catalog-run';
import Player from '../player/Player';
import { Slot } from '../shell/Slot';
import { StudioShell } from '../shell/StudioShell';
import { getClip } from './api';
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
  const { run, rows, error, applyRow } = useCatalog(catalogId);
  const [selected, setSelected] = useState<string | null>(null);
  const [clip, setClip] = useState<AepCompositionJson | null>(null);
  const [clipError, setClipError] = useState<string | null>(null);

  // The stage is never empty once a row is done: the first finished row plays until the owner picks one.
  const firstDone = rows.find((r) => isFinal(r.status) && r.status !== 'failed')?.product.id ?? null;
  useEffect(() => {
    if (selected === null && firstDone) setSelected(firstDone);
  }, [selected, firstDone]);

  const row = useMemo(() => rows.find((r) => r.product.id === selected) ?? null, [rows, selected]);
  const productId = row?.product.id ?? null;
  const version = row?.clipVersion ?? null;
  const status = row?.status ?? null;

  // The clip of the picked row: it is read again whenever the row's clip changes (a price edit
  // bumps the version), so the player never shows an old cut.
  useEffect(() => {
    if (!productId || !status || !isFinal(status)) {
      setClip(null);
      setClipError(null);
      return;
    }
    let stale = false;
    getClip(catalogId, productId).then(
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
  }, [catalogId, productId, version, status]);

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
          <CatalogWall rows={rows} costUsd={run?.costUsd ?? 0} selected={selected} onSelect={setSelected} catalogId={catalogId} onEdited={applyRow} />
        </div>
      }
      sideTitle="Catalog wall"
    />
  );
}
