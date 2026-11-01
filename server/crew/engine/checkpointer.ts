// Owned by S14. A small file-backed checkpointer for the showrunner's own state (docs/hackathon/10-langgraph-orchestration.md §4.2).
// It extends the stock MemorySaver (its tested read/write semantics) and persists the same two maps as JSON after every write.
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { RunnableConfig } from '@langchain/core/runnables';
import {
  MemorySaver,
  type Checkpoint,
  type CheckpointMetadata,
  type PendingWrite,
} from '@langchain/langgraph-checkpoint';

type Storage = MemorySaver['storage'];
type Writes = MemorySaver['writes'];

const MARKER = '__lg_u8';

const replacer = (_key: string, value: unknown): unknown => {
  if (value instanceof Uint8Array) return { [MARKER]: Buffer.from(value).toString('base64') };
  return value;
};

const reviver = (_key: string, value: unknown): unknown => {
  if (value && typeof value === 'object' && typeof (value as Record<string, unknown>)[MARKER] === 'string') {
    return Buffer.from((value as Record<string, string>)[MARKER]!, 'base64');
  }
  return value;
};

function readJson(file: string): { storage?: Storage; writes?: Writes } | undefined {
  try {
    return JSON.parse(readFileSync(file, 'utf8'), reviver) as { storage?: Storage; writes?: Writes };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
}

function writeAtomic(file: string, body: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, body);
  renameSync(tmp, file);
}

/**
 * MemorySaver with a JSON file behind it. One instance is one thread's file, so a film's showrunner state has its own
 * small file next to board.json and the snapshots. Writes are atomic (temp file, then rename).
 */
export class FileSaver extends MemorySaver {
  /** Resolves when the last flush has hit disk. */
  private saving: Promise<void> = Promise.resolve();

  constructor(readonly file: string) {
    super();
    const raw = readJson(file);
    if (raw?.storage) this.storage = raw.storage;
    if (raw?.writes) this.writes = raw.writes;
  }

  override async put(config: RunnableConfig, checkpoint: Checkpoint, metadata: CheckpointMetadata): Promise<RunnableConfig> {
    const next = await super.put(config, checkpoint, metadata);
    await this.flush();
    return next;
  }

  override async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string, taskPath?: string): Promise<void> {
    await super.putWrites(config, writes, taskId, taskPath);
    await this.flush();
  }

  override async deleteThread(threadId: string): Promise<void> {
    await super.deleteThread(threadId);
    await this.flush();
  }

  /** Writes the current maps, serialized behind any write already in flight. */
  flush(): Promise<void> {
    const body = JSON.stringify({ storage: this.storage, writes: this.writes }, replacer);
    this.saving = this.saving.then(() => writeAtomic(this.file, body));
    return this.saving;
  }
}

/** The checkpointer file for one film: data/films/<id>/crew/checkpoints/showrunner.json. */
export function crewCheckpointFile(dataDir: string, filmId: string): string {
  if (!/^film_[a-f0-9]{12}$/.test(filmId)) throw new Error(`bad film id '${filmId}'`);
  return join(dataDir, 'films', filmId, 'crew', 'checkpoints', 'showrunner.json');
}

/** A file saver for one film's showrunner thread. */
export function createCrewCheckpointer(dataDir: string, filmId: string): FileSaver {
  return new FileSaver(crewCheckpointFile(dataDir, filmId));
}
