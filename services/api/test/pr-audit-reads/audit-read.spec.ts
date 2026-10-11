import { ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of, throwError } from 'rxjs';
import {
  AUDIT_READ_KEY,
  AuditRead,
  AuditReadInterceptor,
  AuditReadService,
} from '../../src/audit/audit-read';
import { AuditService } from '../../src/audit/audit.service';
import { RequestUser } from '../../src/authorization/request-user.interface';

/**
 * OI-18 / BRD 18: READ access to sensitive child, medical, billing and family
 * records is audited, de-duplicated, and must never break the read itself.
 */
const user = (over: Partial<RequestUser> = {}): RequestUser =>
  ({ userId: 'u1', orgId: 'org1', centreId: 'c1', role: 'EDUCATOR', sessionId: 's1', ...over }) as RequestUser;

describe('AuditRead decorator', () => {
  class Ctl {
    @AuditRead('attendance', { entityType: 'Child', idParam: 'childId' })
    full() {}
    @AuditRead('incidents')
    bare() {}
  }

  it('attaches full metadata', () => {
    expect(Reflect.getMetadata(AUDIT_READ_KEY, Ctl.prototype.full)).toEqual({
      resource: 'attendance',
      entityType: 'Child',
      idParam: 'childId',
    });
  });

  it('defaults entityType and idParam to null', () => {
    expect(Reflect.getMetadata(AUDIT_READ_KEY, Ctl.prototype.bare)).toEqual({
      resource: 'incidents',
      entityType: null,
      idParam: null,
    });
  });
});

describe('AuditReadService', () => {
  let record: jest.Mock;
  let svc: AuditReadService;
  const t0 = new Date('2026-10-11T00:00:00Z');
  const at = (sec: number) => new Date(t0.getTime() + sec * 1000);
  const spec = { resource: 'attendance', entityType: 'Child', entityId: 'child1' };

  beforeEach(() => {
    delete process.env.AUDIT_READ_DEDUP_SECONDS;
    record = jest.fn(async () => undefined);
    svc = new AuditReadService({ record } as unknown as AuditService);
  });
  afterEach(() => {
    delete process.env.AUDIT_READ_DEDUP_SECONDS;
  });

  it('writes one SUCCESS entry with the expected shape', async () => {
    await svc.record(user(), spec, t0);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({
      orgId: 'org1',
      centreId: 'c1',
      actorUserId: 'u1',
      actorRole: 'EDUCATOR',
      action: 'read.attendance',
      entityType: 'Child',
      entityId: 'child1',
      outcome: 'SUCCESS',
    });
  });

  it('includes metadata { count } only when count is given', async () => {
    await svc.record(user(), { ...spec, entityId: 'a', count: 7 }, t0);
    expect(record.mock.calls[0][0].metadata).toEqual({ count: 7 });
    await svc.record(user(), { ...spec, entityId: 'b' }, t0);
    const second = record.mock.calls[1][0];
    expect(second.metadata === undefined || Object.keys(second.metadata).length === 0).toBe(true);
  });

  it('falls back to entityType Resource and null entityId', async () => {
    await svc.record(user(), { resource: 'incidents', entityType: null, entityId: null }, t0);
    const e = record.mock.calls[0][0];
    expect(e.entityType).toBe('Resource');
    expect(e.entityId ?? null).toBeNull();
    expect(e.action).toBe('read.incidents');
  });

  it('de-duplicates the same actor+action+entity inside the default 300s window', async () => {
    await svc.record(user(), spec, t0);
    await svc.record(user(), spec, at(299));
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('writes again after the window', async () => {
    await svc.record(user(), spec, t0);
    await svc.record(user(), spec, at(301));
    expect(record).toHaveBeenCalledTimes(2);
  });

  it('honours AUDIT_READ_DEDUP_SECONDS read at call time', async () => {
    process.env.AUDIT_READ_DEDUP_SECONDS = '10';
    await svc.record(user(), spec, t0);
    await svc.record(user(), spec, at(5));
    expect(record).toHaveBeenCalledTimes(1);
    await svc.record(user(), spec, at(11));
    expect(record).toHaveBeenCalledTimes(2);
  });

  it('different actor, entity or resource each write their own entry', async () => {
    await svc.record(user(), spec, t0);
    await svc.record(user({ userId: 'u2' }), spec, t0);
    await svc.record(user(), { ...spec, entityId: 'child2' }, t0);
    await svc.record(user(), { ...spec, resource: 'care_records' }, t0);
    expect(record).toHaveBeenCalledTimes(4);
  });

  it('concurrent identical calls write exactly one entry', async () => {
    record.mockImplementation(() => new Promise((r) => setTimeout(r, 20)));
    await Promise.all([1, 2, 3, 4, 5].map(() => svc.record(user(), spec, t0)));
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('ignores users with no orgId (no entry, no throw)', async () => {
    await expect(svc.record(user({ orgId: null }), spec, t0)).resolves.toBeUndefined();
    expect(record).not.toHaveBeenCalled();
  });

  it('swallows AuditService errors and retries on the next call', async () => {
    record.mockRejectedValueOnce(new Error('db down'));
    await expect(svc.record(user(), spec, t0)).resolves.toBeUndefined();
    await svc.record(user(), spec, at(1));
    expect(record).toHaveBeenCalledTimes(2);
    await svc.record(user(), spec, at(2));
    expect(record).toHaveBeenCalledTimes(2);
  });
});

describe('AuditReadInterceptor', () => {
  class Ctl {
    @AuditRead('child_feed', { entityType: 'Child', idParam: 'childId' })
    decorated() {}
    @AuditRead('incidents')
    noId() {}
    plain() {}
  }
  let reads: { record: jest.Mock };
  let interceptor: AuditReadInterceptor;

  const ctxFor = (handler: () => void, req: Record<string, unknown>): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => handler,
      getClass: () => Ctl,
    }) as unknown as ExecutionContext;
  const next = (obs: import('rxjs').Observable<unknown>): CallHandler => ({ handle: () => obs });
  const flush = () => new Promise((r) => setImmediate(r));

  beforeEach(() => {
    reads = { record: jest.fn(async () => undefined) };
    interceptor = new AuditReadInterceptor(new Reflector(), reads as unknown as AuditReadService);
  });

  it('records after success with entityId from idParam and passes the value through', async () => {
    const body = { hello: 'world' };
    const u = user();
    const out = await lastValueFrom(
      interceptor.intercept(ctxFor(Ctl.prototype.decorated, { user: u, params: { childId: 'c9' } }), next(of(body))),
    );
    await flush();
    expect(out).toBe(body);
    expect(reads.record).toHaveBeenCalledTimes(1);
    expect(reads.record).toHaveBeenCalledWith(u, {
      resource: 'child_feed',
      entityType: 'Child',
      entityId: 'c9',
      count: undefined,
    });
  });

  it('uses null entityId when no idParam, and counts array results', async () => {
    const u = user();
    await lastValueFrom(interceptor.intercept(ctxFor(Ctl.prototype.noId, { user: u, params: {} }), next(of([1, 2, 3]))));
    await flush();
    expect(reads.record).toHaveBeenCalledWith(u, { resource: 'incidents', entityType: null, entityId: null, count: 3 });
  });

  it('counts result.items', async () => {
    await lastValueFrom(
      interceptor.intercept(ctxFor(Ctl.prototype.noId, { user: user(), params: {} }), next(of({ items: [1, 2] }))),
    );
    await flush();
    expect(reads.record.mock.calls[0][1].count).toBe(2);
  });

  it('uses null entityId when the param is absent', async () => {
    await lastValueFrom(
      interceptor.intercept(ctxFor(Ctl.prototype.decorated, { user: user(), params: {} }), next(of({}))),
    );
    await flush();
    expect(reads.record.mock.calls[0][1].entityId).toBeNull();
  });

  it('leaves undecorated handlers untouched', async () => {
    const out = await lastValueFrom(
      interceptor.intercept(ctxFor(Ctl.prototype.plain, { user: user(), params: {} }), next(of('x'))),
    );
    await flush();
    expect(out).toBe('x');
    expect(reads.record).not.toHaveBeenCalled();
  });

  it('records nothing when the handler throws', async () => {
    const handler: CallHandler = { handle: () => throwError(() => new Error('boom')) };
    await expect(
      lastValueFrom(interceptor.intercept(ctxFor(Ctl.prototype.decorated, { user: user(), params: { childId: 'c' } }), handler)),
    ).rejects.toThrow('boom');
    await flush();
    expect(reads.record).not.toHaveBeenCalled();
  });

  it('never surfaces an error thrown by reads.record (sync or async)', async () => {
    reads.record.mockImplementationOnce(() => {
      throw new Error('sync fail');
    });
    const a = await lastValueFrom(
      interceptor.intercept(ctxFor(Ctl.prototype.decorated, { user: user(), params: { childId: 'c' } }), next(of('ok'))),
    );
    expect(a).toBe('ok');
    reads.record.mockRejectedValueOnce(new Error('async fail'));
    const b = await lastValueFrom(
      interceptor.intercept(ctxFor(Ctl.prototype.decorated, { user: user(), params: { childId: 'c' } }), next(of('ok2'))),
    );
    expect(b).toBe('ok2');
    await flush();
  });
});
