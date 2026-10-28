// Owned by S7b. Polls a Clippy job politely and gives up cleanly.
import { ClippyError, type ClippyClient } from '../clippy/mcp';
import type { StatusResult } from '../clippy/types';

export const POLL_DELAYS_SEC = [10, 10, 10, 15, 15, 20, 20, 30] as const;
export const POLL_CEILING_MS = 900000;
const MAX_READ_FAILURES = 5;

export type PollOutcome =
  | { kind: 'done'; status: StatusResult }
  | { kind: 'failed'; status: StatusResult | null; message: string }
  | { kind: 'cancelled'; status: StatusResult }
  | { kind: 'timed_out' };

export interface PollDeps {
  sleep?(ms: number): Promise<void>;
  now?(): number;
  onStatus?(s: StatusResult): void;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function errorText(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error === undefined || error === null) return 'unknown error';
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export async function pollJob(client: ClippyClient, jobId: string, deps: PollDeps = {}): Promise<PollOutcome> {
  const sleep = deps.sleep ?? realSleep;
  const now = deps.now ?? Date.now;
  const start = now();
  let tick = 0;
  let readFailures = 0;
  let lastStatus: string | undefined;

  for (;;) {
    if (now() - start > POLL_CEILING_MS) {
      try {
        await client.cancelLiveAnimate(jobId);
      } catch {
        // best effort: the job is abandoned either way
      }
      return { kind: 'timed_out' };
    }

    await sleep(POLL_DELAYS_SEC[Math.min(tick, POLL_DELAYS_SEC.length - 1)]! * 1000);
    tick += 1;

    let status: StatusResult;
    try {
      status = await client.getLiveAnimateStatus(jobId);
    } catch (e) {
      if (!(e instanceof ClippyError)) throw e;
      readFailures += 1;
      if (readFailures >= MAX_READ_FAILURES) return { kind: 'failed', status: null, message: 'status unavailable' };
      continue;
    }
    readFailures = 0;

    if (status.status !== lastStatus) {
      lastStatus = status.status;
      deps.onStatus?.(status);
    }

    if (status.status === 'done') {
      if (!status.resultUrl) return { kind: 'failed', status, message: 'done without a result URL' };
      return { kind: 'done', status };
    }
    if (status.status === 'failed') return { kind: 'failed', status, message: errorText(status.error) };
    if (status.status === 'cancelled') return { kind: 'cancelled', status };
  }
}
