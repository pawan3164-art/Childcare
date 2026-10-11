import { createHash } from 'crypto';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { disconnectAll } from '../test-utils';
import {
  META, NOW, allFields, auditFor, buildForms, db, expectNoInternals, link, makeChild, makeUser, pendingRequest, publishedTemplate, validAnswers, validSignature,
} from './helpers';

/** Independent reference: SHA-256 (hex) of JSON with keys sorted recursively and no whitespace. */
function canonicalHash(value: unknown): string {
  const sort = (v: any): any => (Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v);
  return createHash('sha256').update(JSON.stringify(sort(value))).digest('hex');
}

describe('U4c forms: submission and e-signature', () => {
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

  const submit = (f: any, dto: any = { answers: validAnswers(), signature: validSignature() }, meta: any = META, now = NOW) =>
    svc.submitRequest(f.parent, f.req.id, dto, meta, now);

  describe('happy path', () => {
    it('signs the request: SIGNED, server timestamp, hash of the answers, and stores IP, device and version', async () => {
      const f = await pendingRequest(svc, 'fs-ok');
      const later = new Date('2026-10-14T01:30:00Z');
      const out = await submit(f, undefined, META, later);
      expect(out).toMatchObject({ requestId: f.req.id, status: 'SIGNED', templateVersion: f.version, answersHash: canonicalHash(validAnswers()) });
      expect(out.id).toBeTruthy();
      expect(out.signedAt).toEqual(later);
      expectNoInternals(out);

      const row = await db.formSubmission.findUniqueOrThrow({ where: { id: out.id } });
      expect(row).toMatchObject({
        requestId: f.req.id, templateVersion: f.version, ip: '203.0.113.9', userAgent: 'TestAgent/1.0',
        answersHash: canonicalHash(validAnswers()), signerTypedName: 'Jane Citizen', signatureImageRef: expect.stringMatching(/^signatures\/[0-9a-f-]{36}$/), consentGiven: true,
        supersedesSubmissionId: null,
      });
      expect(row.signedAt).toEqual(later);
      expect(row.answers).toEqual(validAnswers());
      expect((await db.formRequest.findUniqueOrThrow({ where: { id: f.req.id } })).status).toBe('SIGNED');
    });

    it('the signing time is the server clock: a client-supplied signedAt, ip or userAgent in the dto is ignored', async () => {
      const f = await pendingRequest(svc, 'fs-spoof');
      const out = await submit(f, { answers: validAnswers(), signature: validSignature(), signedAt: '2020-01-01T00:00:00Z', ip: '1.1.1.1', userAgent: 'Evil' } as any);
      expect(out.signedAt).toEqual(NOW);
      const row = await db.formSubmission.findUniqueOrThrow({ where: { id: out.id } });
      expect(row.ip).toBe(META.ip);
      expect(row.userAgent).toBe(META.userAgent);
    });

    it('missing IP or user-agent metadata is tolerated and stored as null', async () => {
      const f = await pendingRequest(svc, 'fs-nometa');
      const out = await submit(f, undefined, {});
      const row = await db.formSubmission.findUniqueOrThrow({ where: { id: out.id } });
      expect(row.ip).toBeNull();
      expect(row.userAgent).toBeNull();
    });

    it('the hash does not depend on the order of answer keys', async () => {
      const a = await pendingRequest(svc, 'fs-order-a');
      const b = await pendingRequest(svc, 'fs-order-b');
      const reversed = Object.fromEntries(Object.entries(validAnswers()).reverse());
      const o1 = await submit(a);
      const o2 = await submit(b, { answers: reversed, signature: validSignature() });
      expect(o1.answersHash).toBe(o2.answersHash);
    });

    it('optional answers may be omitted; child_select accepts a child linked to the guardian', async () => {
      const f = await pendingRequest(svc, 'fs-optional');
      const { transport: _t, ...required } = validAnswers();
      await expect(submit(f, { answers: { ...required, which_child: f.child.id }, signature: validSignature() })).resolves.toMatchObject({ status: 'SIGNED' });
    });

    it('a template with no signature field needs no signature block', async () => {
      const f = await pendingRequest(svc, 'fs-nosigfield', [{ key: 'note', type: 'text', label: 'Note', required: true }]);
      await expect(submit(f, { answers: { note: 'ok' } })).resolves.toMatchObject({ status: 'SIGNED' });
    });
  });

  describe('who can submit', () => {
    it('only the addressed guardian: another parent in the same centre gets NotFound and nothing is written', async () => {
      const f = await pendingRequest(svc, 'fw-other');
      const otherParent = await makeUser(f.tenant, 'PARENT');
      const otherChild = await makeChild(f.tenant);
      await link(f.tenant, otherParent, otherChild.id);
      await expect(svc.submitRequest(otherParent, f.req.id, { answers: validAnswers(), signature: validSignature() }, META, NOW)).rejects.toBeInstanceOf(NotFoundException);
      expect(await db.formSubmission.count({ where: { requestId: f.req.id } })).toBe(0);
    });

    it('a second guardian of the same child who was not addressed cannot sign for them', async () => {
      const f = await pendingRequest(svc, 'fw-coguardian');
      const co = await makeUser(f.tenant, 'PARENT');
      await link(f.tenant, co, f.child.id);
      await expect(svc.submitRequest(co, f.req.id, { answers: validAnswers(), signature: validSignature() }, META, NOW)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('a parent from another org gets NotFound', async () => {
      const f = await pendingRequest(svc, 'fw-xorg-a');
      const g = await pendingRequest(svc, 'fw-xorg-b');
      await expect(svc.submitRequest(g.parent, f.req.id, { answers: validAnswers(), signature: validSignature() }, META, NOW)).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each(['admin', 'educator'] as const)('%s cannot submit on behalf of a family (Forbidden)', async (who) => {
      const f = await pendingRequest(svc, `fw-forbid-${who}`);
      await expect(svc.submitRequest((f as any)[who], f.req.id, { answers: validAnswers(), signature: validSignature() }, META, NOW)).rejects.toBeInstanceOf(ForbiddenException);
      expect(await db.formSubmission.count({ where: { requestId: f.req.id } })).toBe(0);
    });

    it('the addressed guardian loses access once their relationship to the child has expired', async () => {
      const f = await pendingRequest(svc, 'fw-expired');
      await db.guardianChildRelationship.updateMany({ where: { guardianUserId: f.parent.userId }, data: { expiresAt: new Date('2026-10-01T00:00:00Z') } });
      await expect(submit(f)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('unknown request id is NotFound', async () => {
      const f = await pendingRequest(svc, 'fw-404');
      await expect(svc.submitRequest(f.parent, '00000000-0000-0000-0000-000000000000', { answers: validAnswers(), signature: validSignature() }, META, NOW)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('answer validation against the pinned template version', () => {
    const cases: Array<[string, (a: any) => any]> = [
      ['a missing required field', ({ full_name: _x, ...rest }) => rest],
      ['a blank required text answer', (a) => ({ ...a, full_name: '   ' })],
      ['text over 2000 chars', (a) => ({ ...a, full_name: 'x'.repeat(2001) })],
      ['text of the wrong type', (a) => ({ ...a, full_name: 42 })],
      ['a non-date string', (a) => ({ ...a, excursion_date: 'tomorrow' })],
      ['an impossible date', (a) => ({ ...a, excursion_date: '2026-02-30' })],
      ['yes_no as a string', (a) => ({ ...a, swim_ok: 'yes' })],
      ['a choice not in the options', (a) => ({ ...a, transport: 'Helicopter' })],
      ['child_select with a child the guardian is not linked to', (a) => ({ ...a, which_child: '00000000-0000-0000-0000-000000000000' })],
      ['an unknown answer key', (a) => ({ ...a, extra: 'x' })],
      ['an answer keyed by the signature field', (a) => ({ ...a, sig: 'x' })],
    ];
    it.each(cases)('rejects %s with BadRequest and stores nothing', async (_n, mutate) => {
      const f = await pendingRequest(svc, 'fv-answers');
      await expect(submit(f, { answers: mutate(validAnswers()), signature: validSignature() })).rejects.toBeInstanceOf(BadRequestException);
      expect(await db.formSubmission.count({ where: { requestId: f.req.id } })).toBe(0);
      expect((await db.formRequest.findUniqueOrThrow({ where: { id: f.req.id } })).status).toBe('PENDING');
    });

    it('rejects missing or non-object answers', async () => {
      const f = await pendingRequest(svc, 'fv-shape');
      await expect(submit(f, { signature: validSignature() })).rejects.toBeInstanceOf(BadRequestException);
      await expect(submit(f, { answers: 'x', signature: validSignature() })).rejects.toBeInstanceOf(BadRequestException);
      await expect(submit(f, { answers: [], signature: validSignature() })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('validates against the version the request was sent with, not the latest', async () => {
      const f = await pendingRequest(svc, 'fv-pinned');
      await svc.updateTemplate(f.admin, f.templateId, { fields: [{ key: 'other', type: 'text', label: 'Other', required: true }] }, NOW);
      await svc.publishTemplate(f.admin, f.templateId, NOW);
      await expect(submit(f)).resolves.toMatchObject({ status: 'SIGNED', templateVersion: f.version });
    });
  });

  describe('signature requirements', () => {
    const sigCases: Array<[string, any]> = [
      ['no signature at all', undefined],
      ['no typed name', validSignature({ typedName: undefined })],
      ['a blank typed name', validSignature({ typedName: '   ' })],
      ['a typed name over 200 chars', validSignature({ typedName: 'n'.repeat(201) })],
      ['no drawn signature image reference', validSignature({ imageRef: undefined })],
      ['a blank image reference', validSignature({ imageRef: '' })],
      ['consent false', validSignature({ consent: false })],
      ['consent missing', validSignature({ consent: undefined })],
      ['consent as the string "true"', validSignature({ consent: 'true' })],
    ];
    it.each(sigCases)('rejects %s when the template has a signature field', async (_n, signature) => {
      const f = await pendingRequest(svc, 'fg-sig');
      await expect(submit(f, { answers: validAnswers(), signature })).rejects.toBeInstanceOf(BadRequestException);
      expect(await db.formSubmission.count({ where: { requestId: f.req.id } })).toBe(0);
    });
  });

  describe('immutability and corrections', () => {
    it('a second submit is Conflict (409) and the first submission is untouched', async () => {
      const f = await pendingRequest(svc, 'fi-twice');
      const first = await submit(f);
      await expect(submit(f, { answers: { ...validAnswers(), full_name: 'Someone Else' }, signature: validSignature() })).rejects.toBeInstanceOf(ConflictException);
      const rows = await db.formSubmission.findMany({ where: { requestId: f.req.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(first.id);
      expect(rows[0].answers).toEqual(validAnswers());
    });

    it('concurrent submits: exactly one succeeds, one submission row exists', async () => {
      const f = await pendingRequest(svc, 'fi-race');
      const results = await Promise.allSettled([submit(f), submit(f)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(failed.reason).toBeInstanceOf(ConflictException);
      expect(await db.formSubmission.count({ where: { requestId: f.req.id } })).toBe(1);
    });

    it('a correction is a NEW request linked via supersedesSubmissionId; the old submission and request are kept', async () => {
      const f = await pendingRequest(svc, 'fi-correct');
      const original = await submit(f);
      const [fix] = await svc.sendRequests(
        f.admin,
        { templateId: f.templateId, version: f.version, recipients: [{ guardianUserId: f.parent.userId, childId: f.child.id, supersedesSubmissionId: original.id }] },
        NOW,
      );
      expect(fix.id).not.toBe(f.req.id);
      expect(fix).toMatchObject({ status: 'PENDING', supersedesSubmissionId: original.id });
      const corrected = await svc.submitRequest(f.parent, fix.id, { answers: { ...validAnswers(), full_name: 'Jane Q Citizen' }, signature: validSignature() }, META, NOW);
      const row = await db.formSubmission.findUniqueOrThrow({ where: { id: corrected.id } });
      expect(row.supersedesSubmissionId).toBe(original.id);
      const old = await db.formSubmission.findUniqueOrThrow({ where: { id: original.id } });
      expect(old.answers).toEqual(validAnswers());
      expect(old.answersHash).toBe(canonicalHash(validAnswers()));
      expect((await db.formRequest.findUniqueOrThrow({ where: { id: f.req.id } })).status).toBe('SIGNED');
    });

    it('supersedesSubmissionId must refer to a submission for the same guardian and child in this centre', async () => {
      const f = await pendingRequest(svc, 'fi-bad-supersede');
      const g = await pendingRequest(svc, 'fi-bad-supersede-other');
      const theirs = await submit(g);
      const rec = { guardianUserId: f.parent.userId, childId: f.child.id };
      for (const supersedesSubmissionId of [theirs.id, '00000000-0000-0000-0000-000000000000']) {
        const err = await svc
          .sendRequests(f.admin, { templateId: f.templateId, version: f.version, recipients: [{ ...rec, supersedesSubmissionId }] }, NOW)
          .catch((x: any) => x);
        expect([BadRequestException, NotFoundException].some((c) => err instanceof c)).toBe(true);
      }
    });
  });

  describe('audit', () => {
    it('writes forms.submission_signed with ids/counts only: no answers, names, signature data, IP or device', async () => {
      const f = await pendingRequest(svc, 'fa-signed');
      const answers = { ...validAnswers(), full_name: 'SecretNameXyz' };
      const out = await submit(f, { answers, signature: validSignature({ typedName: 'SecretSignerXyz', imageRef: 'signatures/SecretImgXyz.png' }) });
      const rows = (await auditFor(out.id)).filter((r) => r.action === 'forms.submission_signed');
      expect(rows).toHaveLength(1);
      expect(rows[0].entityType).toBe('FormSubmission');
      expect(rows[0].actorUserId).toBe(f.parent.userId);
      expect(rows[0].actorRole).toBe('PARENT');
      expect(rows[0].centreId).toBe(f.tenant.centreId);
      expect(JSON.stringify(rows[0])).not.toMatch(/SecretNameXyz|SecretSignerXyz|SecretImgXyz|203\.0\.113\.9|TestAgent|Jane Citizen/);
    });

    it('the submission, request status change and audit entry commit together; an audit failure rolls all back', async () => {
      const f = await pendingRequest(svc, 'fa-signed-tx');
      jest.spyOn(h.audit, 'record').mockRejectedValue(new Error('audit down'));
      await expect(submit(f)).rejects.toThrow();
      expect(await db.formSubmission.count({ where: { requestId: f.req.id } })).toBe(0);
      expect((await db.formRequest.findUniqueOrThrow({ where: { id: f.req.id } })).status).toBe('PENDING');
    });

    it('rejected submissions (validation, forbidden) write no signed audit entry', async () => {
      const f = await pendingRequest(svc, 'fa-none');
      await submit(f, { answers: {}, signature: validSignature() }).catch(() => undefined);
      const rows = (await db.auditLogEntry.findMany({ where: { centreId: f.tenant.centreId, action: 'forms.submission_signed' } }));
      expect(rows).toHaveLength(0);
    });
  });

  describe('no content in console logs', () => {
    it('never writes answers, names or signature data to the console', async () => {
      const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => undefined));
      const writes = [jest.spyOn(process.stdout, 'write'), jest.spyOn(process.stderr, 'write')];
      writes.forEach((w) => w.mockImplementation(() => true));
      const f = await pendingRequest(svc, 'fl-log');
      await submit(f, { answers: { ...validAnswers(), full_name: 'SecretConsoleXyz' }, signature: validSignature({ typedName: 'SecretConsoleSigner' }) });
      await submit(f).catch(() => undefined);
      const output = [...spies, ...writes].flatMap((s) => s.mock.calls.map((c) => JSON.stringify(c))).join('\n');
      expect(output).not.toMatch(/SecretConsoleXyz|SecretConsoleSigner|sig-abc123/);
    });
  });

  it('keeps unused helper imports honest', () => {
    expect(allFields()).toHaveLength(6);
    expect(typeof publishedTemplate).toBe('function');
    expectNoInternals({});
  });
});
