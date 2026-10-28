export interface ModeToggleProps {
  sceneId: string;
  mode: 'motion' | 'generate';
  busy?: boolean;
  disabledReason?: string;
  onChange(mode: 'motion' | 'generate'): void;
}

const OPTIONS = [
  { value: 'motion', label: 'MOTION' },
  { value: 'generate', label: 'GENERATE' },
] as const;

export default function ModeToggle({ sceneId, mode, busy, disabledReason, onChange }: ModeToggleProps) {
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
      {mode === 'motion' && !disabledReason && <p>Real video costs about 25 credits and needs your approval.</p>}
      {disabledReason && <p>{disabledReason}</p>}
    </div>
  );
}
