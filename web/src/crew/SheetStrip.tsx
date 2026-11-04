import { useEffect, useState } from 'react';
import type { AssetRef } from '@shared/composition';

/** The sheets Muse checked a 3D film on (product, element, set and film sheets), as a row of thumbnails; a click opens one large. Nothing when the film has none. */
export function SheetStrip({ assets }: { assets: AssetRef[] }) {
  // the same sheet can come from the film and from its art.asset event: shown once
  const sheets = assets.filter((a, i) => a.role === 'sheet' && assets.findIndex((b) => b.id === a.id) === i);
  const [open, setOpen] = useState<AssetRef>();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(undefined);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!sheets.length) return null;
  return (
    <>
      <div className="sheet-strip" aria-label="Sheets">
        {sheets.map((a, i) => (
          <button key={a.id} type="button" onClick={() => setOpen(a)} className="sheet-thumb">
            <img src={a.url} alt={`Sheet ${i + 1} of ${sheets.length}`} />
          </button>
        ))}
      </div>
      {open && (
        <div role="dialog" aria-label="Sheet" data-testid="sheet-overlay" onClick={() => setOpen(undefined)} className="sheet-overlay">
          <img src={open.url} alt="Sheet, large" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  );
}
