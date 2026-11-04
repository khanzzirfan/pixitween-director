// Owned by S12d. One job as a chip: what, which scene, how it is going, and a way to stop it.
import type { Job } from '@shared/crew';
import { KIND_ICON, STATUS_LABEL, isOpen } from './format';

export function JobChip({ job, onCancel }: { job: Job; onCancel?: (jobId: string) => void }) {
  const superseded = job.status === 'superseded';
  const label = superseded ? `replaced by ${job.supersededBy ?? '?'}` : STATUS_LABEL[job.status];
  return (
    <span className={`job-chip st-${job.status}${superseded ? ' is-superseded' : ''}`} title={job.reason || job.brief} data-job={job.id}>
      <span className="job-icon" aria-hidden="true">{KIND_ICON[job.kind]}</span>
      <span className="job-kind">{job.kind.replace('-scene', '')}</span>
      {job.sceneId && <span className="job-scene">{job.sceneId}</span>}
      <span className="job-status">{label}</span>
      {job.status === 'done' && job.ms !== undefined && <span className="job-ms">{job.ms >= 1000 ? `${(job.ms / 1000).toFixed(1)} s` : `${job.ms} ms`}</span>}
      {isOpen(job) && onCancel && (
        <button type="button" className="job-cancel" aria-label={`Cancel ${job.id}`} onClick={() => onCancel(job.id)}>
          Cancel
        </button>
      )}
    </span>
  );
}
