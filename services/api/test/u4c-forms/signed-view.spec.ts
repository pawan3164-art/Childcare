import 'reflect-metadata';
import { BadRequestException, ForbiddenException, NotFoundException, RequestMethod } from '@nestjs/common';
import { JwtAuthGuard } from '../../src/authorization/guards/jwt-auth.guard';
import { FormsController } from '../../src/forms/forms.controller';
import { disconnectAll } from '../test-utils';
import { META, NOW, buildForms, db, expectNoInternals, makeUser, pendingRequest, setupFamily, validAnswers, validSignature } from './helpers';

/**
 * OI-41: the admin read path for signed forms. Assumed shapes:
 *   FormsService.getSubmission(admin, submissionId)
 *   FormsService.listSubmissions(admin, { childId? })
 */
describe('U4c forms: admin signed-form view', () => {
  let h: Awaited<ReturnType<typeof buildForms>>;
  let svc: any;
  beforeAll(async () => {
    h = await buildForms();
    svc = h.service;
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await disconnectAll();
  });

  async function signed(label: string) {
    const f = await pendingRequest(svc, label);
    const sub = await svc.submitRequest(f.parent, f.req.id, { answers: validAnswers(), signature: validSignature() }, META, NOW);
    return { ...f, sub };
  }
  const views = (centreId: string, entityId: string) => db.auditLogEntry.findMany({ where: { centreId, entityId, action: 'forms.submission_viewed' } });

  describe('getSubmission', () => {
    it('returns the full signed record with the pinned version fields, recomputed validity and the drawn strokes', async () => {
      const f = await signed('sv-get');
      const out = await svc.getSubmission(f.admin, f.sub.id);
      expect(out).toMatchObject({
        id: f.sub.id,
        requestId: f.req.id,
        templateId: f.templateId,
        templateVersion: f.version,
        title: 'Excursion consent',
        childId: f.child.id,
        guardianUserId: f.parent.userId,
        answers: validAnswers(),
        answersHash: f.sub.answersHash,
        valid: true,
        signerTypedName: 'Jane Citizen',
        consentGiven: true,
        supersedesSubmissionId: null,
        signature: { strokes: [[[0.1, 0.1], [0.5, 0.5]]] },
      });
      expect(out.signedAt).toBeTruthy();
      expect(Array.isArray(out.fields)).toBe(true);
      expect(out.fields.map((x: any) => x.key)).toEqual(expect.arrayContaining(['full_name', 'swim_ok', 'sig']));
    });

    it('never returns ip, user agent, tenant ids or the signature reference', async () => {
      const f = await signed('sv-internals');
      const out = await svc.getSubmission(f.admin, f.sub.id);
      expectNoInternals(out);
      for (const k of ['ip', 'userAgent', 'orgId', 'centreId', 'signatureImageRef']) expect(Object.keys(out)).not.toContain(k);
      const text = JSON.stringify(out);
      expect(text).not.toContain(META.ip);
      expect(text).not.toContain(META.userAgent);
      expect(text).not.toContain('signatures/');
    });

    it('reports valid false when stored answers no longer match the hash', async () => {
      const f = await signed('sv-tamper');
      await db.$transaction([
        db.$executeRawUnsafe('SET LOCAL session_replication_role = replica'),
        db.$executeRawUnsafe(`UPDATE form_submissions SET answers = jsonb_set(answers, '{swim_ok}', 'false') WHERE id = '${f.sub.id}'`),
      ]);
      expect((await svc.getSubmission(f.admin, f.sub.id)).valid).toBe(false);
    });

    it('signature is null when the stored signature row is missing', async () => {
      const f = await signed('sv-nosig');
      await db.$transaction([
        db.$executeRawUnsafe('SET LOCAL session_replication_role = replica'),
        db.$executeRawUnsafe(`DELETE FROM form_signatures WHERE request_id = '${f.req.id}'`),
      ]);
      const out = await svc.getSubmission(f.admin, f.sub.id);
      expect(out.signature).toBeNull();
      expect(out.id).toBe(f.sub.id);
    });

    it('is admin-only and centre-scoped; unknown and non-uuid ids are NotFound', async () => {
      const f = await signed('sv-access');
      const other = await setupFamily('sv-access-other');
      await expect(svc.getSubmission(f.educator, f.sub.id)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.getSubmission(f.parent, f.sub.id)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.getSubmission(other.admin, f.sub.id)).rejects.toBeInstanceOf(NotFoundException);
      await expect(svc.getSubmission(f.admin, '00000000-0000-0000-0000-000000000000')).rejects.toBeInstanceOf(NotFoundException);
      await expect(svc.getSubmission(f.admin, 'not-a-uuid')).rejects.toBeInstanceOf(NotFoundException);
      const orgAdmin = await makeUser(f.tenant, 'ORG_ADMIN');
      await expect(svc.getSubmission(orgAdmin, f.sub.id)).resolves.toMatchObject({ id: f.sub.id });
    });

    it('a refused read writes no viewed audit entry', async () => {
      const f = await signed('sv-refused');
      const other = await setupFamily('sv-refused-other');
      await svc.getSubmission(f.educator, f.sub.id).catch(() => undefined);
      await svc.getSubmission(other.admin, f.sub.id).catch(() => undefined);
      expect(await views(f.tenant.centreId, f.sub.id)).toHaveLength(0);
      expect(await views(other.tenant.centreId, f.sub.id)).toHaveLength(0);
    });
  });

  describe('listSubmissions', () => {
    it('lists newest first with the summary fields only, no answers', async () => {
      const f = await signed('sv-list');
      const later = new Date(NOW.getTime() + 60_000);
      const [req2] = await svc.sendRequests(
        f.admin,
        { templateId: f.templateId, version: f.version, recipients: [{ guardianUserId: f.parent.userId, childId: f.child.id }] },
        later,
      );
      const sub2 = await svc.submitRequest(f.parent, req2.id, { answers: validAnswers(), signature: validSignature() }, META, later);
      const out = await svc.listSubmissions(f.admin, {});
      expect(out.map((x: any) => x.id)).toEqual([sub2.id, f.sub.id]);
      expect(out[0]).toEqual({
        id: sub2.id,
        requestId: req2.id,
        title: 'Excursion consent',
        templateVersion: f.version,
        childId: f.child.id,
        signedAt: expect.anything(),
        signerTypedName: 'Jane Citizen',
      });
      expect(JSON.stringify(out)).not.toContain('answers');
      expectNoInternals(out);
    });

    it('filters by childId and rejects a non-uuid childId with BadRequest', async () => {
      const f = await signed('sv-list-child');
      const hit = await svc.listSubmissions(f.admin, { childId: f.child.id });
      expect(hit.map((x: any) => x.id)).toEqual([f.sub.id]);
      expect(await svc.listSubmissions(f.admin, { childId: '00000000-0000-0000-0000-000000000000' })).toEqual([]);
      await expect(svc.listSubmissions(f.admin, { childId: 'nope' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.listSubmissions(f.admin, { childId: 42 as any })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('is admin-only and centre-scoped', async () => {
      const f = await signed('sv-list-access');
      const other = await setupFamily('sv-list-access-other');
      await expect(svc.listSubmissions(f.educator, {})).rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.listSubmissions(f.parent, {})).rejects.toBeInstanceOf(ForbiddenException);
      expect((await svc.listSubmissions(other.admin, {})).map((x: any) => x.id)).not.toContain(f.sub.id);
      expect((await svc.listSubmissions(f.admin, {})).map((x: any) => x.id)).toContain(f.sub.id);
    });
  });

  describe('read audit', () => {
    it('viewing a submission writes forms.submission_viewed with ids only', async () => {
      const f = await signed('sv-audit');
      await svc.getSubmission(f.admin, f.sub.id);
      const rows = await views(f.tenant.centreId, f.sub.id);
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0]).toMatchObject({ action: 'forms.submission_viewed', entityType: 'FormSubmission', entityId: f.sub.id, actorUserId: f.admin.userId });
      const text = JSON.stringify(rows);
      for (const secret of ['Jane Citizen', '2026-11-02', 'strokes', f.sub.answersHash]) expect(text).not.toContain(secret);
    });

    it('repeat views by the same admin write at most one entry per call, and the first always writes', async () => {
      const f = await signed('sv-audit-repeat');
      await svc.getSubmission(f.admin, f.sub.id);
      expect(await views(f.tenant.centreId, f.sub.id)).toHaveLength(1);
      await svc.getSubmission(f.admin, f.sub.id);
      const n = (await views(f.tenant.centreId, f.sub.id)).length;
      expect(n === 1 || n === 2).toBe(true); // either deduped within 5 minutes or one per call
    });

    it('a different admin viewing the same submission is audited as that admin', async () => {
      const f = await signed('sv-audit-two');
      const admin2 = await makeUser(f.tenant, 'CENTRE_ADMIN');
      await svc.getSubmission(f.admin, f.sub.id);
      await svc.getSubmission(admin2, f.sub.id);
      const actors = (await views(f.tenant.centreId, f.sub.id)).map((r: any) => r.actorUserId);
      expect(actors).toEqual(expect.arrayContaining([f.admin.userId, admin2.userId]));
    });

    it('is recorded through AuditService.record with the transaction client', async () => {
      const f = await signed('sv-audit-tx');
      const spy = jest.spyOn(h.audit, 'record');
      await svc.getSubmission(f.admin, f.sub.id);
      const call = spy.mock.calls.find((c: any[]) => c[0]?.action === 'forms.submission_viewed');
      expect(call).toBeDefined();
      expect(call![1]).toBeDefined();
      expect(call![0]).toMatchObject({ entityType: 'FormSubmission', entityId: f.sub.id });
    });

    it('an audit failure makes the read fail', async () => {
      const f = await signed('sv-audit-fail');
      jest.spyOn(h.audit, 'record').mockRejectedValue(new Error('audit down'));
      await expect(svc.getSubmission(f.admin, f.sub.id)).rejects.toThrow();
    });
  });

  describe('FormsController routes', () => {
    const fullPath = (handler: string): string => {
      const base: string = Reflect.getMetadata('path', FormsController) ?? '';
      const sub: string = Reflect.getMetadata('path', (FormsController.prototype as any)[handler]) ?? '';
      return [base, sub].join('/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
    };
    const guards = (handler: string): unknown[] => [
      ...(Reflect.getMetadata('__guards__', FormsController) ?? []),
      ...(Reflect.getMetadata('__guards__', (FormsController.prototype as any)[handler]) ?? []),
    ];

    it.each([
      ['listSubmissions', 'forms/submissions'],
      ['getSubmission', 'forms/submissions/:id'],
      ['verifySubmission', 'forms/submissions/:id/verify'],
    ])('%s is a GET at %s behind JwtAuthGuard', (handler, path) => {
      const fn = (FormsController.prototype as any)[handler];
      expect(typeof fn).toBe('function');
      expect(Reflect.getMetadata('method', fn)).toBe(RequestMethod.GET);
      expect(fullPath(handler)).toBe(path);
      expect(guards(handler)).toContain(JwtAuthGuard);
    });

    it('delegates to the service, passing the childId filter for the list', () => {
      const get = (FormsController.prototype as any).getSubmission.toString();
      const list = (FormsController.prototype as any).listSubmissions.toString();
      expect(get).toMatch(/getSubmission\(/);
      expect(list).toMatch(/listSubmissions\(/);
      expect(list).toMatch(/childId/);
    });
  });
});
