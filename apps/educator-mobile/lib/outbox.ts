import { api, ApiError } from './api-client';

/**
 * Minimal offline outbox for the sync engine (POST /sync/operations, one op per batch). Each
 * operation carries its own idempotency key and client-generated entity id,
 * so retrying after a dropped connection is always safe: the server stores
 * it once. Each op records who made it and is only ever sent with that
 * person's session: on a shared room tablet, educator A's queued sleep check
 * must never upload (and be attributed) under educator B's login. Other
 * users' ops wait until their owner signs in again. Persisted in localStorage on web; in memory on native until the
 * app gets on-device storage (U3), so a native app restart loses the queue.
 */
export interface SyncOp {
  ownerUserId: string;
  idempotencyKey: string;
  clientOperationId: string;
  entityType: string;
  entityId: string;
  operationType: 'CREATE';
  clientTimestamp: string;
  payload: Record<string, unknown>;
}

const KEY = 'childcare_outbox';
let memory: SyncOp[] = [];
const listeners = new Set<(pending: number) => void>();
let flushing = false;
let owner: string | null = null;

/** Called by the auth context on sign-in and sign-out. */
export function setOutboxOwner(userId: string | null) {
  owner = userId;
  notify();
}

function mine(ops: SyncOp[]): SyncOp[] {
  return owner ? ops.filter((o) => o.ownerUserId === owner) : [];
}

function notify() {
  const n = mine(load()).length;
  listeners.forEach((l) => l(n));
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

function load(): SyncOp[] {
  const s = storage();
  if (!s) return memory;
  try {
    return JSON.parse(s.getItem(KEY) ?? '[]') as SyncOp[];
  } catch {
    return [];
  }
}

function save(ops: SyncOp[]) {
  memory = ops;
  try {
    storage()?.setItem(KEY, JSON.stringify(ops));
  } catch {
    // storage blocked: the in-memory copy still holds the queue this session
  }
  notify();
}

export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // RN without crypto.randomUUID: RFC 4122 v4 from Math.random is fine for client ids.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Ops waiting to upload for the signed-in user. */
export function pendingCount(): number {
  return mine(load()).length;
}

export function onPendingChange(listener: (pending: number) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Drops the signed-in user's queued ops (explicit sign-out, after the profile screen's warning). */
export function clearOutbox() {
  if (owner) save(load().filter((o) => o.ownerUserId !== owner));
}

export type EnqueueResult = { status: 'sent' } | { status: 'queued' } | { status: 'rejected'; message: string };

/** Queue an operation and try to send it now. */
export async function enqueue(op: Omit<SyncOp, 'ownerUserId' | 'idempotencyKey' | 'clientOperationId' | 'clientTimestamp'>): Promise<EnqueueResult> {
  if (!owner) throw new Error('Sign in before recording anything');
  const full: SyncOp = { ...op, ownerUserId: owner, idempotencyKey: uuid(), clientOperationId: uuid(), clientTimestamp: new Date().toISOString() };
  save([...load(), full]);
  const { rejected } = await flush();
  const mine = rejected.find((r) => r.idempotencyKey === full.idempotencyKey);
  if (mine) return { status: 'rejected', message: mine.message };
  return load().some((o) => o.idempotencyKey === full.idempotencyKey) ? { status: 'queued' } : { status: 'sent' };
}

/**
 * Send queued operations in order. A network failure stops the flush and
 * keeps the queue; a 4xx means the server rejected the op (e.g. access
 * revoked) and it is dropped so it can't block everything behind it.
 */
export async function flush(): Promise<{ rejected: { idempotencyKey: string; message: string }[] }> {
  const rejected: { idempotencyKey: string; message: string }[] = [];
  if (flushing) return { rejected };
  flushing = true;
  try {
    for (const op of mine(load())) {
      const { ownerUserId: _owner, ...wire } = op;
      try {
        await api.post('/sync/operations', [wire]);
      } catch (err) {
        if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 408 && err.status !== 429) {
          rejected.push({ idempotencyKey: op.idempotencyKey, message: err.message });
        } else {
          break; // offline or server error: try again later
        }
      }
      save(load().filter((o) => o.idempotencyKey !== op.idempotencyKey));
    }
  } finally {
    flushing = false;
  }
  return { rejected };
}
