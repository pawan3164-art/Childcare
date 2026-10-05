import { api, ApiError } from './api-client';
import { enqueue, uuid } from './outbox';

export interface GroupCareBody {
  type: string;
  timestamp: string;
  defaultNote?: string;
  defaultDetails?: Record<string, unknown>;
  childIds: string[];
  exceptions?: { childId: string; skip?: boolean; note?: string; details?: Record<string, unknown> }[];
}

/**
 * Logs a group care event. Online it uses the group endpoint; if the device
 * can't reach the server it expands the event into one CareRecord sync op per
 * child (sharing a groupEventId) and queues them, so a sleep check or nappy
 * change done offline still reaches the timeline once the device reconnects.
 * Server rejections (4xx) are thrown, not queued.
 */
export async function logGroupCare(body: GroupCareBody): Promise<{ count: number; offline: boolean }> {
  try {
    const result = await api.post<{ records: unknown[] }>('/care-records/group', body);
    return { count: result.records.length, offline: false };
  } catch (err) {
    if (err instanceof ApiError) throw err;
  }

  const groupEventId = uuid();
  const byChild = new Map((body.exceptions ?? []).map((e) => [e.childId, e]));
  const included = body.childIds.filter((id) => !byChild.get(id)?.skip);
  for (const childId of included) {
    const ex = byChild.get(childId);
    await enqueue({
      entityType: 'CareRecord',
      entityId: uuid(),
      operationType: 'CREATE',
      payload: {
        childId,
        type: body.type,
        timestamp: body.timestamp,
        note: ex?.note ?? body.defaultNote,
        details: ex?.details ?? body.defaultDetails,
        groupEventId,
      },
    });
  }
  return { count: included.length, offline: true };
}
