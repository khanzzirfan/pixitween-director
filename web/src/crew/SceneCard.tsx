// Owned by S12d. One scene of the live storyboard: its plan, its status ring, and editable fields that send one update op each.
import { useEffect, useState, type DragEvent } from 'react';
import type { Job } from '@shared/crew';
import type { Scene } from '@shared/storyboard';

export type RingState = 'queued' | 'building' | 'reviewing' | 'done' | 'failed';

/** The scene's status from its latest writing job, and whether a critique of it is under way. */
export function ringFor(jobs: Job[], sceneId: string): RingState {
  const mine = jobs.filter((j) => j.sceneId === sceneId);
  const writing = mine.filter((j) => !['critique', 'continuity', 'take'].includes(j.kind));
  const latest = writing.at(-1);
  if (!latest) return 'queued';
  if (latest.status === 'running') return 'building';
  if (latest.status === 'queued') return 'queued';
  if (latest.status === 'awaiting-frames') return 'reviewing';
  if (latest.status === 'failed') return 'failed';
  if (latest.status === 'done') {
    const reviewing = mine.some((j) => j.kind === 'critique' && (j.status === 'running' || j.status === 'awaiting-frames' || j.status === 'queued'));
    return reviewing ? 'reviewing' : 'done';
  }
  return 'queued'; // cancelled and superseded: the scene waits for its next job
}

const CAMERAS: Scene['camera'][] = ['static', 'dolly-in', 'pan', 'orbit', 'parallax'];
const DURATIONS = [2, 3, 4, 5, 6, 7, 8];

interface CardProps {
  scene: Scene;
  index: number;
  total: number;
  ring: RingState;
  isNew: boolean;
  canRemove: boolean;
  onPatch(sceneId: string, patch: Partial<Omit<Scene, 'id'>>): void;
  onRemove(sceneId: string): void;
  onMove(sceneId: string, dir: -1 | 1): void;
  onDragStart(sceneId: string): void;
  onDropOn(sceneId: string): void;
}

function EditableText({ value, label, multiline, onSave }: { value: string; label: string; multiline?: boolean; onSave(v: string): void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const v = draft.trim();
    if (v === value || !v) return setDraft(value);
    onSave(v);
  };
  return (
    <textarea
      className={`card-edit${multiline ? ' multi' : ''}`}
      aria-label={label}
      rows={multiline ? 2 : 1}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
    />
  );
}

export function SceneCard({ scene, index, total, ring, isNew, canRemove, onPatch, onRemove, onMove, onDragStart, onDropOn }: CardProps) {
  const drag = (e: DragEvent) => {
    e.dataTransfer.setData('text/plain', scene.id);
    e.dataTransfer.effectAllowed = 'move';
    onDragStart(scene.id);
  };
  return (
    <article
      className={`scene-card ring-${ring}${isNew ? ' is-new' : ''}`}
      data-scene={scene.id}
      draggable
      onDragStart={drag}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDropOn(scene.id);
      }}
    >
      <header className="card-top">
        <span className="card-no">{index + 1}</span>
        <span className="card-id">{scene.id}</span>
        <span className={`ring-pill ring-${ring}`} data-testid="ring">
          <i aria-hidden="true" />
          {ring}
        </span>
      </header>
      <EditableText value={scene.intent} label={`Intent of ${scene.id}`} multiline onSave={(v) => onPatch(scene.id, { intent: v })} />
      {scene.text !== undefined && <EditableText value={scene.text} label={`Text of ${scene.id}`} onSave={(v) => onPatch(scene.id, { text: v })} />}
      <div className="card-meta">
        <label>
          <span className="visually-hidden">Camera of {scene.id}</span>
          <select aria-label={`Camera of ${scene.id}`} value={scene.camera} onChange={(e) => onPatch(scene.id, { camera: e.target.value as Scene['camera'] })}>
            {CAMERAS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          <select aria-label={`Duration of ${scene.id}`} value={scene.durationSec} onChange={(e) => onPatch(scene.id, { durationSec: Number(e.target.value) })}>
            {[...new Set([...DURATIONS, scene.durationSec])].sort((a, b) => a - b).map((d) => (
              <option key={d} value={d}>{d} s</option>
            ))}
          </select>
        </label>
        <span className="tag shot">{scene.shotType}</span>
        <span className={`tag mode-${scene.mode}`} title={scene.modeReason}>{scene.mode}</span>
      </div>
      <footer className="card-actions">
        <button type="button" aria-label={`Move ${scene.id} up`} disabled={index === 0} onClick={() => onMove(scene.id, -1)}>↑</button>
        <button type="button" aria-label={`Move ${scene.id} down`} disabled={index === total - 1} onClick={() => onMove(scene.id, 1)}>↓</button>
        <button type="button" className="danger" aria-label={`Remove ${scene.id}`} disabled={!canRemove} title={canRemove ? 'Remove this scene' : 'A film needs at least 2 scenes'} onClick={() => onRemove(scene.id)}>
          Remove
        </button>
      </footer>
    </article>
  );
}
