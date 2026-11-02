// Owned by S14. The showrunner's LangGraph checkpointer over director.db (tables lg_checkpoints, lg_writes).
// Same observable behaviour as the stock MemorySaver (sqlite-saver.test.ts compares them); the serde does the encoding.
import type { RunnableConfig } from '@langchain/core/runnables';
import {
  BaseCheckpointSaver,
  TASKS,
  WRITES_IDX_MAP,
  compareWritesSortKeys,
  copyCheckpoint,
  getCheckpointId,
  maxChannelVersion,
  writesSortKey,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointTuple,
  type PendingWrite,
  type SerializerProtocol,
} from '@langchain/langgraph-checkpoint';
import type { Db } from '../../db/open';
import { tx } from '../../db/open';

interface CheckpointRow {
  thread_id: string;
  checkpoint_ns: string;
  checkpoint_id: string;
  parent_checkpoint_id: string | null;
  type: string;
  checkpoint: Uint8Array;
  metadata: Uint8Array;
}
interface WriteRow {
  task_id: string;
  idx: number;
  task_path: string;
  channel: string;
  type: string;
  value: Uint8Array;
}

const toBytes = (b: Uint8Array): Uint8Array => new Uint8Array(b);
/** better-sqlite3 binds Buffers, not bare Uint8Arrays. */
const blob = (b: Uint8Array): Buffer => Buffer.from(b.buffer, b.byteOffset, b.byteLength);

export class SqliteSaver extends BaseCheckpointSaver {
  constructor(
    private readonly db: Db,
    serde?: SerializerProtocol,
  ) {
    super(serde);
  }

  /** Stored writes for one checkpoint, in the order LangGraph expects (writesSortKey). */
  private orderedWrites(threadId: string, ns: string, checkpointId: string): WriteRow[] {
    const rows = this.db
      .prepare('SELECT task_id, idx, task_path, channel, type, value FROM lg_writes WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?')
      .all(threadId, ns, checkpointId) as unknown as WriteRow[];
    return rows
      .map((r) => ({ r, key: writesSortKey(r.task_path, r.task_id, r.idx) }))
      .sort((a, b) => compareWritesSortKeys(a.key, b.key))
      .map((x) => x.r);
  }

  private async pendingWrites(threadId: string, ns: string, checkpointId: string): Promise<[string, string, unknown][]> {
    return Promise.all(
      this.orderedWrites(threadId, ns, checkpointId).map(
        async (w) => [w.task_id, w.channel, await this.serde.loadsTyped(w.type, toBytes(w.value))] as [string, string, unknown],
      ),
    );
  }

  private async toTuple(row: CheckpointRow, config: RunnableConfig): Promise<CheckpointTuple> {
    const checkpoint = (await this.serde.loadsTyped(row.type, toBytes(row.checkpoint))) as Checkpoint;
    if (checkpoint.v < 4 && row.parent_checkpoint_id !== null) {
      // old checkpoints kept their pending sends in the parent's writes
      const sends = await Promise.all(
        this.orderedWrites(row.thread_id, row.checkpoint_ns, row.parent_checkpoint_id)
          .filter((w) => w.channel === TASKS)
          .map((w) => this.serde.loadsTyped(w.type, toBytes(w.value))),
      );
      checkpoint.channel_values ??= {};
      checkpoint.channel_values[TASKS] = sends;
      checkpoint.channel_versions ??= {};
      checkpoint.channel_versions[TASKS] =
        Object.keys(checkpoint.channel_versions).length > 0 ? maxChannelVersion(...Object.values(checkpoint.channel_versions)) : this.getNextVersion(undefined);
    }
    const tuple: CheckpointTuple = {
      config,
      checkpoint,
      metadata: (await this.serde.loadsTyped(row.type, toBytes(row.metadata))) as CheckpointMetadata,
      pendingWrites: (await this.pendingWrites(row.thread_id, row.checkpoint_ns, row.checkpoint_id)) as CheckpointTuple['pendingWrites'],
    };
    if (row.parent_checkpoint_id !== null) {
      tuple.parentConfig = {
        configurable: {
          thread_id: row.thread_id,
          checkpoint_ns: row.checkpoint_ns,
          checkpoint_id: row.parent_checkpoint_id,
        },
      };
    }
    return tuple;
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id as string | undefined;
    const ns = (config.configurable?.checkpoint_ns as string | undefined) ?? '';
    const checkpointId = getCheckpointId(config);
    if (threadId === undefined) return undefined;
    const row = (
      checkpointId
        ? this.db.prepare('SELECT * FROM lg_checkpoints WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?').get(threadId, ns, checkpointId)
        : this.db.prepare('SELECT * FROM lg_checkpoints WHERE thread_id = ? AND checkpoint_ns = ? ORDER BY checkpoint_id DESC LIMIT 1').get(threadId, ns)
    ) as CheckpointRow | undefined;
    if (!row) return undefined;
    return this.toTuple(
      row,
      checkpointId
        ? config
        : {
            configurable: {
              thread_id: threadId,
              checkpoint_id: row.checkpoint_id,
              checkpoint_ns: ns,
            },
          },
    );
  }

  async *list(config: RunnableConfig, options?: CheckpointListOptions): AsyncGenerator<CheckpointTuple> {
    const { before, filter } = options ?? {};
    let limit = options?.limit;
    const where: string[] = [];
    const args: string[] = [];
    const threadId = config.configurable?.thread_id as string | undefined;
    const ns = config.configurable?.checkpoint_ns as string | undefined;
    const id = config.configurable?.checkpoint_id as string | undefined;
    if (threadId) {
      where.push('thread_id = ?');
      args.push(threadId);
    }
    if (ns !== undefined) {
      where.push('checkpoint_ns = ?');
      args.push(ns);
    }
    if (id) {
      where.push('checkpoint_id = ?');
      args.push(id);
    }
    const beforeId = before?.configurable?.checkpoint_id as string | undefined;
    if (beforeId) {
      where.push('checkpoint_id < ?');
      args.push(beforeId);
    }
    const rows = this.db
      .prepare(`SELECT * FROM lg_checkpoints ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY thread_id, checkpoint_ns, checkpoint_id DESC`)
      .all(...args) as unknown as CheckpointRow[];
    for (const row of rows) {
      if (filter) {
        const metadata = (await this.serde.loadsTyped(row.type, toBytes(row.metadata))) as Record<string, unknown>;
        if (!Object.entries(filter).every(([k, v]) => metadata[k] === v)) continue;
      }
      if (limit !== undefined) {
        if (limit <= 0) break;
        limit -= 1;
      }
      yield await this.toTuple(row, {
        configurable: {
          thread_id: row.thread_id,
          checkpoint_ns: row.checkpoint_ns,
          checkpoint_id: row.checkpoint_id,
        },
      });
    }
  }

  async put(config: RunnableConfig, checkpoint: Checkpoint, metadata: CheckpointMetadata): Promise<RunnableConfig> {
    const threadId = config.configurable?.thread_id as string | undefined;
    const ns = (config.configurable?.checkpoint_ns as string | undefined) ?? '';
    if (threadId === undefined) {
      throw new Error('Failed to put checkpoint. The passed RunnableConfig is missing a required "thread_id" field in its "configurable" property.');
    }
    const [type, bytes] = await this.serde.dumpsTyped(copyCheckpoint(checkpoint));
    const [, metaBytes] = await this.serde.dumpsTyped(metadata);
    this.db
      .prepare(
        `INSERT INTO lg_checkpoints (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (thread_id, checkpoint_ns, checkpoint_id) DO UPDATE SET parent_checkpoint_id = excluded.parent_checkpoint_id, type = excluded.type, checkpoint = excluded.checkpoint, metadata = excluded.metadata`,
      )
      .run(threadId, ns, checkpoint.id, (config.configurable?.checkpoint_id as string | undefined) ?? null, type, blob(bytes), blob(metaBytes));
    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: ns,
        checkpoint_id: checkpoint.id,
      },
    };
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string, taskPath?: string): Promise<void> {
    const threadId = config.configurable?.thread_id as string | undefined;
    const ns = (config.configurable?.checkpoint_ns as string | undefined) ?? '';
    const checkpointId = config.configurable?.checkpoint_id as string | undefined;
    if (threadId === undefined) {
      throw new Error('Failed to put writes. The passed RunnableConfig is missing a required "thread_id" field in its "configurable" property.');
    }
    if (checkpointId === undefined) {
      throw new Error('Failed to put writes. The passed RunnableConfig is missing a required "checkpoint_id" field in its "configurable" property.');
    }
    const encoded = await Promise.all(
      writes.map(async ([channel, value], i) => {
        const [type, bytes] = await this.serde.dumpsTyped(value);
        return { channel, type, bytes, idx: WRITES_IDX_MAP[channel] || i };
      }),
    );
    tx(this.db, () => {
      // a regular write is kept once (first wins); the special channels (negative idx) replace
      const sql = (verb: string) =>
        `INSERT ${verb} INTO lg_writes (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, task_path, channel, type, value) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      const keep = this.db.prepare(sql('OR IGNORE'));
      const replace = this.db.prepare(sql('OR REPLACE'));
      for (const w of encoded) {
        (w.idx >= 0 ? keep : replace).run(threadId, ns, checkpointId, taskId, w.idx, taskPath ?? '', w.channel, w.type, blob(w.bytes));
      }
    });
  }

  async deleteThread(threadId: string): Promise<void> {
    tx(this.db, () => {
      this.db.prepare('DELETE FROM lg_checkpoints WHERE thread_id = ?').run(threadId);
      this.db.prepare('DELETE FROM lg_writes WHERE thread_id = ?').run(threadId);
    });
  }
}
