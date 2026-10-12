import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { disconnectAll } from '../test-utils';
import {
  META, NOW, allFields, auditFor, buildForms, db, expectNoInternals, link, makeChild, makeUser, pendingRequest, publishedTemplate, setupFamily, validAnswers, validSignature,
} from './helpers';

describe('U4c forms: requests (send, cancel, parent view)', () => {
  let h: Awaited<ReturnType<typeof buildForms>>;
  let svc: any;
  beforeAll(async () => {
    h = await buildForms();
    svc = h.service;
  });
  afterAll(async () => {
    await disconnectAll();
  });
  afterEach(() => jest.restoreAllMocks());

  describe('sendRequests', () => {
    it('creates one PENDING request per guardian+child with the documented shape', async () => {
      const f = await setupFamily('fr-send');
      const second = await makeUser(f.tenant, 'PARENT');
      await link(f.tenant, second, f.child.id);
      const child2 = await makeChild(f.tenant);
      await link(f.tenant, f.parent, child2.id);
      const { templateId, version } = await publishedTemplate(svc, f.admin);
      const out = await svc.sendRequests(
        f.admin,
        {
          templateId,
          version,
          dueDate: '2026-10-20',
          recipients: [
            { guardianUserId: f.parent.userId, childId: f.child.id },
            { guardianUserId: f.parent.userId, childId: child2.id },
            { guardianUserId: second.userId, childId: f.child.id },
          ],
        },
        NOW,
      );
      expect(out).toHaveLength(3);
      for (const r of out) {
        expect(r).toMatchObject({ templateId, templateVersion: version, status: 'PENDING', dueDate: '2026-10-20', signedAt: null, title: 'Excursion consent' });
        expect(r.id).toBeTruthy();
      }
      expectNoInternals(out);
      expect(await db.formRequest.count({ where: { templateId } })).toBe(3);
    });

    it('duplicate recipients within one call collapse to one row', async () => {
      const f = await setupFamily('fr-dupe');
      const { templateId, version } = await publishedTemplate(svc, f.admin);
      const rec = { guardianUserId: f.parent.userId, childId: f.child.id };
      const out = await svc.sendRequests(f.admin, { templateId, version, recipients: [rec, rec] }, NOW);
      expect(out).toHaveLength(1);
    });

    it('dueDate is optional (null) and must be a real date not before today in centre time', async () => {
      const f = await setupFamily('fr-due');
      const { templateId, version } = await publishedTemplate(svc, f.admin);
      const rec = [{ guardianUserId: f.parent.userId, childId: f.child.id }];
      const ok = await svc.sendRequests(f.admin, { templateId, version, recipients: rec }, NOW);
      expect(ok[0].dueDate).toBeNull();
      // 2026-10-13T20:00Z is 2026-10-14 in Sydney: the 13th is yesterday, the 14th is today.
      await expect(svc.sendRequests(f.admin, { templateId, version, recipients: rec, dueDate: '2026-10-13' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.sendRequests(f.admin, { templateId, version, recipients: rec, dueDate: '2026-02-30' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.sendRequests(f.admin, { templateId, version, recipients: rec, dueDate: 'soon' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.sendRequests(f.admin, { templateId, version, recipients: rec, dueDate: '2026-10-14' }, NOW)).resolves.toHaveLength(1);
    });

    it('rejects an empty recipient list and more than 200 recipients', async () => {
      const f = await setupFamily('fr-count');
      const { templateId, version } = await publishedTemplate(svc, f.admin);
      await expect(svc.sendRequests(f.admin, { templateId, version, recipients: [] }, NOW)).rejects.toBeInstanceOf(BadRequestException);
      const many = Array.from({ length: 201 }, () => ({ guardianUserId: f.parent.userId, childId: f.child.id }));
      // Duplicates would collapse, so the cap must be on the submitted list.
      await expect(svc.sendRequests(f.admin, { templateId, version, recipients: many }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('requires a published version: draft-only templates and unknown versions are rejected', async () => {
      const f = await setupFamily('fr-unpublished');
      const draft = await svc.createTemplate(f.admin, { title: 'Draft', fields: allFields() }, NOW);
      const rec = [{ guardianUserId: f.parent.userId, childId: f.child.id }];
      const e1 = await svc.sendRequests(f.admin, { templateId: draft.id, version: 1, recipients: rec }, NOW).catch((x: any) => x);
      expect([BadRequestException, NotFoundException].some((c) => e1 instanceof c)).toBe(true);
      const { templateId } = await publishedTemplate(svc, f.admin);
      const e2 = await svc.sendRequests(f.admin, { templateId, version: 99, recipients: rec }, NOW).catch((x: any) => x);
      expect([BadRequestException, NotFoundException].some((c) => e2 instanceof c)).toBe(true);
      expect(await db.formRequest.count({ where: { centreId: f.tenant.centreId } })).toBe(0);
    });

    it('a request pins the version it was sent with, even after the template is edited and republished', async () => {
      const f = await setupFamily('fr-pin');
      const { templateId, version } = await publishedTemplate(svc, f.admin);
      const [req] = await svc.sendRequests(f.admin, { templateId, version, recipients: [{ guardianUserId: f.parent.userId, childId: f.child.id }] }, NOW);
      await svc.updateTemplate(f.admin, templateId, { title: 'Changed' }, NOW);
      await svc.publishTemplate(f.admin, templateId, NOW);
      const mine = await svc.getMyRequest(f.parent, req.id, NOW);
      expect(mine.templateVersion).toBe(version);
      expect(mine.title).toBe('Excursion consent');
    });

    it('guardian must have a CURRENT relationship to that child; otherwise BadRequest and NOTHING is created', async () => {
      const f = await setupFamily('fr-rel');
      const stranger = await makeUser(f.tenant, 'PARENT');
      const expired = await makeUser(f.tenant, 'PARENT');
      await link(f.tenant, expired, f.child.id, { expiresAt: new Date('2026-09-01T00:00:00Z') });
      const { templateId, version } = await publishedTemplate(svc, f.admin);
      for (const bad of [stranger, expired]) {
        await expect(
          svc.sendRequests(
            f.admin,
            { templateId, version, recipients: [{ guardianUserId: f.parent.userId, childId: f.child.id }, { guardianUserId: bad.userId, childId: f.child.id }] },
            NOW,
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
      expect(await db.formRequest.count({ where: { templateId } })).toBe(0);
    });

    it('a recipient who is not a parent user (educator/admin) is rejected', async () => {
      const f = await setupFamily('fr-role');
      const { templateId, version } = await publishedTemplate(svc, f.admin);
      await expect(
        svc.sendRequests(f.admin, { templateId, version, recipients: [{ guardianUserId: f.educator.userId, childId: f.child.id }] }, NOW),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('children and guardians from another centre or org are rejected (BadRequest or NotFound), nothing created', async () => {
      const a = await setupFamily('fr-iso-a');
      const b = await setupFamily('fr-iso-b');
      const sibling = await db.centre.create({ data: { orgId: a.tenant.orgId, name: 'Sib' } });
      const sibChild = await db.child.create({
        data: { orgId: a.tenant.orgId, centreId: sibling.id, firstName: 'Sib', lastName: 'Kid', dateOfBirth: new Date('2023-01-01') },
      });
      const { templateId, version } = await publishedTemplate(svc, a.admin);
      const attempts = [
        [{ guardianUserId: b.parent.userId, childId: b.child.id }],
        [{ guardianUserId: a.parent.userId, childId: b.child.id }],
        [{ guardianUserId: a.parent.userId, childId: sibChild.id }],
        [{ guardianUserId: a.parent.userId, childId: '00000000-0000-0000-0000-000000000000' }],
      ];
      for (const recipients of attempts) {
        const err = await svc.sendRequests(a.admin, { templateId, version, recipients }, NOW).catch((x: any) => x);
        expect([BadRequestException, NotFoundException].some((c) => err instanceof c)).toBe(true);
      }
      expect(await db.formRequest.count({ where: { templateId } })).toBe(0);
    });

    it('cannot send another centre or org template (NotFound)', async () => {
      const a = await setupFamily('fr-tpl-a');
      const b = await setupFamily('fr-tpl-b');
      const theirs = await publishedTemplate(svc, b.admin);
      await expect(
        svc.sendRequests(a.admin, { templateId: theirs.templateId, version: theirs.version, recipients: [{ guardianUserId: a.parent.userId, childId: a.child.id }] }, NOW),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each(['educator', 'parent'] as const)('%s is Forbidden', async (who) => {
      const f = await setupFamily(`fr-forbid-${who}`);
      const { templateId, version } = await publishedTemplate(svc, f.admin);
      await expect(
        svc.sendRequests((f as any)[who], { templateId, version, recipients: [{ guardianUserId: f.parent.userId, childId: f.child.id }] }, NOW),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(await db.formRequest.count({ where: { templateId } })).toBe(0);
    });

    it('enqueues one ACTION_REQUIRED push per request containing ids only (no title, names or content)', async () => {
      const f = await setupFamily('fr-notify');
      const second = await makeUser(f.tenant, 'PARENT');
      await link(f.tenant, second, f.child.id);
      const t = await svc.createTemplate(f.admin, { title: 'SecretTitleXyz', description: 'SecretDescXyz', fields: allFields() }, NOW);
      const { version } = await svc.publishTemplate(f.admin, t.id, NOW);
      const out = await svc.sendRequests(
        f.admin,
        { templateId: t.id, version, recipients: [{ guardianUserId: f.parent.userId, childId: f.child.id }, { guardianUserId: second.userId, childId: f.child.id }] },
        NOW,
      );
      const items = await db.notificationQueueItem.findMany({ where: { recipientUserId: { in: [f.parent.userId, second.userId] } } });
      expect(items).toHaveLength(2);
      for (const item of items) {
        expect(item.priority).toBe('ACTION_REQUIRED');
        expect(item.channel).toBe('PUSH');
        expect(item.centreId).toBe(f.tenant.centreId);
        const payload = item.payload as any;
        expect(payload.type).toBe('form_requested');
        expect(out.map((r: any) => r.id)).toContain(payload.formRequestId);
        expect(payload.childId).toBe(f.child.id);
        expect(JSON.stringify(payload)).not.toMatch(/SecretTitleXyz|SecretDescXyz|Fam-/);
      }
    });

    it('audits forms.request_sent per request with ids/counts only, in the same transaction', async () => {
      const f = await setupFamily('fr-audit');
      const t = await svc.createTemplate(f.admin, { title: 'SecretTitleXyz', fields: allFields() }, NOW);
      const { version } = await svc.publishTemplate(f.admin, t.id, NOW);
      const [req] = await svc.sendRequests(f.admin, { templateId: t.id, version, recipients: [{ guardianUserId: f.parent.userId, childId: f.child.id }] }, NOW);
      const rows = (await auditFor(req.id)).filter((r) => r.action === 'forms.request_sent');
      expect(rows).toHaveLength(1);
      expect(rows[0].entityType).toBe('FormRequest');
      expect(rows[0].actorUserId).toBe(f.admin.userId);
      expect(JSON.stringify(rows[0])).not.toMatch(/SecretTitleXyz|Fam-/);

      const t2 = await publishedTemplate(svc, f.admin);
      jest.spyOn(h.audit, 'recordMany').mockRejectedValue(new Error('audit down'));
      await expect(
        svc.sendRequests(f.admin, { templateId: t2.templateId, version: t2.version, recipients: [{ guardianUserId: f.parent.userId, childId: f.child.id }] }, NOW),
      ).rejects.toThrow();
      expect(await db.formRequest.count({ where: { templateId: t2.templateId } })).toBe(0);
    });
  });

  describe('cancelRequest', () => {
    it('cancels an unsigned request, keeps the row, and the parent no longer sees it as pending', async () => {
      const f = await pendingRequest(svc, 'fc-ok');
      const out = await svc.cancelRequest(f.admin, f.req.id, NOW);
      expect(out).toMatchObject({ id: f.req.id, status: 'CANCELLED' });
      expectNoInternals(out);
      expect((await db.formRequest.findUniqueOrThrow({ where: { id: f.req.id } })).cancelledAt).not.toBeNull();
      const pending = await svc.listMyRequests(f.parent, { status: 'PENDING' }, NOW);
      expect(pending.find((r: any) => r.id === f.req.id)).toBeUndefined();
    });

    it('a cancelled request cannot be submitted (Conflict)', async () => {
      const f = await pendingRequest(svc, 'fc-nosubmit');
      await svc.cancelRequest(f.admin, f.req.id, NOW);
      await expect(
        svc.submitRequest(f.parent, f.req.id, { answers: validAnswers(), signature: validSignature() }, META, NOW),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(await db.formSubmission.count({ where: { requestId: f.req.id } })).toBe(0);
    });

    it('cancelling twice, or cancelling a signed request, is Conflict', async () => {
      const f = await pendingRequest(svc, 'fc-conflict');
      await svc.cancelRequest(f.admin, f.req.id, NOW);
      await expect(svc.cancelRequest(f.admin, f.req.id, NOW)).rejects.toBeInstanceOf(ConflictException);

      const g = await pendingRequest(svc, 'fc-signed');
      await svc.submitRequest(g.parent, g.req.id, { answers: validAnswers(), signature: validSignature() }, META, NOW);
      await expect(svc.cancelRequest(g.admin, g.req.id, NOW)).rejects.toBeInstanceOf(ConflictException);
      expect((await db.formRequest.findUniqueOrThrow({ where: { id: g.req.id } })).cancelledAt).toBeNull();
    });

    it.each(['educator', 'parent'] as const)('%s is Forbidden', async (who) => {
      const f = await pendingRequest(svc, `fc-forbid-${who}`);
      await expect(svc.cancelRequest((f as any)[who], f.req.id, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('unknown id and another centre/org request are NotFound and unchanged', async () => {
      const a = await setupFamily('fc-iso-a');
      const b = await pendingRequest(svc, 'fc-iso-b');
      await expect(svc.cancelRequest(a.admin, '00000000-0000-0000-0000-000000000000', NOW)).rejects.toBeInstanceOf(NotFoundException);
      await expect(svc.cancelRequest(a.admin, b.req.id, NOW)).rejects.toBeInstanceOf(NotFoundException);
      expect((await db.formRequest.findUniqueOrThrow({ where: { id: b.req.id } })).cancelledAt).toBeNull();
    });

    it('audits forms.request_cancelled in the same transaction', async () => {
      const f = await pendingRequest(svc, 'fc-audit');
      const g = await pendingRequest(svc, 'fc-audit-tx');
      await svc.cancelRequest(f.admin, f.req.id, NOW);
      const rows = (await auditFor(f.req.id)).filter((r) => r.action === 'forms.request_cancelled');
      expect(rows).toHaveLength(1);
      expect(rows[0].entityType).toBe('FormRequest');

      jest.spyOn(h.audit, 'record').mockRejectedValue(new Error('audit down'));
      await expect(svc.cancelRequest(g.admin, g.req.id, NOW)).rejects.toThrow();
      expect((await db.formRequest.findUniqueOrThrow({ where: { id: g.req.id } })).cancelledAt).toBeNull();
    });
  });

  describe('admin listRequests', () => {
    it('lists the centre requests with status and optional filters; admin only; centre-scoped', async () => {
      const f = await pendingRequest(svc, 'fa-list');
      const other = await pendingRequest(svc, 'fa-list-other');
      const all = await svc.listRequests(f.admin, {}, NOW);
      expect(all.map((r: any) => r.id)).toEqual([f.req.id]);
      expectNoInternals(all);
      expect(await svc.listRequests(f.admin, { status: 'SIGNED' }, NOW)).toEqual([]);
      expect((await svc.listRequests(f.admin, { childId: f.child.id }, NOW)).map((r: any) => r.id)).toEqual([f.req.id]);
      expect((await svc.listRequests(other.admin, {}, NOW)).map((r: any) => r.id)).toEqual([other.req.id]);
      await expect(svc.listRequests(f.educator, {}, NOW)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.listRequests(f.parent, {}, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('parent view', () => {
    it('lists only the parent own pending and signed requests, newest first, with status filter', async () => {
      const f = await pendingRequest(svc, 'fp-mine');
      const second = await makeUser(f.tenant, 'PARENT');
      const child2 = await makeChild(f.tenant);
      await link(f.tenant, second, child2.id);
      await svc.sendRequests(f.admin, { templateId: f.templateId, version: f.version, recipients: [{ guardianUserId: second.userId, childId: child2.id }] }, NOW);
      const mine = await svc.listMyRequests(f.parent, {}, NOW);
      expect(mine.map((r: any) => r.id)).toEqual([f.req.id]);
      expect(mine[0]).toMatchObject({ status: 'PENDING', childId: f.child.id, templateVersion: f.version });
      expectNoInternals(mine);

      await svc.submitRequest(f.parent, f.req.id, { answers: validAnswers(), signature: validSignature() }, META, NOW);
      expect((await svc.listMyRequests(f.parent, { status: 'SIGNED' }, NOW)).map((r: any) => r.id)).toEqual([f.req.id]);
      expect(await svc.listMyRequests(f.parent, { status: 'PENDING' }, NOW)).toEqual([]);
    });

    it('getMyRequest returns the pinned version fields so the form can be rendered', async () => {
      const f = await pendingRequest(svc, 'fp-get');
      const r = await svc.getMyRequest(f.parent, f.req.id, NOW);
      expect(r).toMatchObject({ id: f.req.id, status: 'PENDING', title: 'Excursion consent' });
      expect(r.fields).toHaveLength(6);
      expectNoInternals(r);
    });

    it('a signed request exposes signedAt but never the typed name, IP, device or signature reference to the list', async () => {
      const f = await pendingRequest(svc, 'fp-signed-view');
      await svc.submitRequest(f.parent, f.req.id, { answers: validAnswers(), signature: validSignature() }, META, NOW);
      const [r] = await svc.listMyRequests(f.parent, { status: 'SIGNED' }, NOW);
      expect(r.signedAt).toBeInstanceOf(Date);
      expect(JSON.stringify(r)).not.toMatch(/203\.0\.113\.9|TestAgent|sig-abc123/);
    });

    it('another family cannot read or list a request (NotFound), even in the same centre', async () => {
      const f = await pendingRequest(svc, 'fp-other');
      const otherParent = await makeUser(f.tenant, 'PARENT');
      const otherChild = await makeChild(f.tenant);
      await link(f.tenant, otherParent, otherChild.id);
      await expect(svc.getMyRequest(otherParent, f.req.id, NOW)).rejects.toBeInstanceOf(NotFoundException);
      expect(await svc.listMyRequests(otherParent, {}, NOW)).toEqual([]);
    });

    it('a parent in another org cannot read the request (NotFound)', async () => {
      const f = await pendingRequest(svc, 'fp-xorg-a');
      const g = await setupFamily('fp-xorg-b');
      await expect(svc.getMyRequest(g.parent, f.req.id, NOW)).rejects.toBeInstanceOf(NotFoundException);
      expect(await svc.listMyRequests(g.parent, {}, NOW)).toEqual([]);
    });

    it('a guardian whose relationship has since expired no longer sees the request', async () => {
      const f = await pendingRequest(svc, 'fp-expired');
      await db.guardianChildRelationship.updateMany({ where: { guardianUserId: f.parent.userId }, data: { expiresAt: new Date('2026-10-01T00:00:00Z') } });
      expect(await svc.listMyRequests(f.parent, {}, NOW)).toEqual([]);
      await expect(svc.getMyRequest(f.parent, f.req.id, NOW)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('educators have no parent view (Forbidden); admins use listRequests instead', async () => {
      const f = await pendingRequest(svc, 'fp-educator');
      await expect(svc.listMyRequests(f.educator, {}, NOW)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.getMyRequest(f.educator, f.req.id, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
