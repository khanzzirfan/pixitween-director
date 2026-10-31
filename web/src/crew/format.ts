// Owned by S12d. Small shared formatters for the crew panels.
import type { Job } from '@shared/crew';

export const cents = (usd: number) => `${Math.round(usd * 100)}¢`;
export const dollars = (usd: number) => `$${usd.toFixed(2)}`;
export const secondsSince = (iso: string | undefined, now: number) => (iso ? Math.max(0, Math.floor((now - Date.parse(iso)) / 1000)) : 0);

export const KIND_ICON: Record<Job['kind'], string> = {
  'build-scene': '🏗',
  'rebuild-scene': '♻',
  'restyle-scene': '🎨',
  edit: '✎',
  fix: '🔧',
  take: '🎞',
  critique: '👁',
  continuity: '🔗',
  revert: '↩',
  'cast-character': '🎭',
  'make-prop': '🧸',
  'make-set': '🎬',
  'make-motion': '🕺',
  'block-shot': '📐',
};

export const STATUS_LABEL: Record<Job['status'], string> = {
  queued: 'queued',
  running: 'running',
  'awaiting-frames': 'waiting for frames',
  done: 'done',
  failed: 'failed',
  cancelled: 'cancelled',
  superseded: 'superseded',
};

export const isOpen = (j: Pick<Job, 'status'>) => j.status === 'queued' || j.status === 'running' || j.status === 'awaiting-frames';
