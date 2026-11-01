export type SceneMode = 'motion' | 'generate' | '3d';

export interface ModeToggleProps {
  sceneId: string;
  mode: SceneMode;
  busy?: boolean;
  disabledReason?: string;
  /** Offer the third option: the real product turning in 3D (S13). */
  product3d?: boolean;
  onChange(mode: SceneMode): void;
}

const TWO = [
  { value: 'motion', label: 'MOTION' },
  { value: 'generate', label: 'GENERATE' },
] as const;
const THREE = [
  { value: 'motion', label: 'MOTION' },
  { value: '3d', label: '3D' },
  { value: 'generate', label: 'GENERATE' },
] as const;

export default function ModeToggle({ sceneId, mode, busy, disabledReason, product3d, onChange }: ModeToggleProps) {
  const OPTIONS = product3d ? THREE : TWO;
  return (
    <div>
      <div role="radiogroup" aria-label="Scene mode" data-scene={sceneId} style={{ display: 'inline-flex', gap: 4 }}>
        {OPTIONS.map((o) => {
          const selected = o.value === mode;
          const disabled = !!busy || (o.value === 'generate' && !!disabledReason && !selected);
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => !selected && onChange(o.value)}
              style={{ fontWeight: selected ? 700 : 400 }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {mode === '3d' && <p className="mode-hint">The real product turns in studio light. It is free, and you can switch back at any time.</p>}
      {mode !== 'generate' && !disabledReason && <p className="mode-hint">Real video costs about 25 credits and needs your approval.</p>}
      {disabledReason && <p>{disabledReason}</p>}
    </div>
  );
}
