import { BadRequestException } from '@nestjs/common';
import { disconnectAll } from '../test-utils';
import { META, NOW, allFields, auditFor, buildForms, db, link, makeChild, makeUser, pendingRequest, publishedTemplate, setupFamily, validAnswers, validSignature } from './helpers';

/** Fixes from the U4c security review (H1, H2, M2, M4, L1, L2). */
describe('U4c forms: security review fixes', () => {
  let h: Awaited<ReturnType<typeof buildForms>>;
  let svc: any;
  beforeAll(async () => {
    h = await buildForms();
    svc = h.service;
  });
  afterAll(async () => {
    await disconnectAll();
  });

  describe('H1: restricted and pickup-only guardians', () => {
    it('cannot be sent a form (nothing created)', async () => {
      const f = await setupFamily('rv-send');
      const restricted = await makeUser(f.tenant, 'PARENT');
      await link(f.tenant, restricted, f.child.id, { isRestricted: true });
      const pickup = await makeUser(f.tenant, 'PARENT');
      const rel = await link(f.tenant, pickup, f.child.id);
      await db.guardianChildRelationship.update({ where: { id: rel.id }, data: { relationshipType: 'AUTHORIZED_PICKUP' } });
      const { templateId, version } = await publishedTemplate(svc, f.admin);
      for (const bad of [restricted, pickup]) {
        await expect(svc.sendRequests(f.admin, { templateId, version, recipients: [{ guardianUserId: bad.userId, childId: f.child.id }] }, NOW)).rejects.toBeInstanceOf(BadRequestException);
      }
      expect(await db.formRequest.count({ where: { templateId } })).toBe(0);
    });

    it('lose access to a request already sent once they become restricted', async () => {
      const f = await pendingRequest(svc, 'rv-lose');
      await db.guardianChildRelationship.updateMany({ where: { guardianUserId: f.parent.userId }, data: { isRestricted: true } });
      expect(await svc.listMyRequests(f.parent, {}, NOW)).toEqual([]);
      await expect(svc.submitRequest(f.parent, f.req.id, { answers: validAnswers(), signature: validSignature() }, META, NOW)).rejects.toThrow();
      expect(await db.formSubmission.count({ where: { requestId: f.req.id } })).toBe(0);
    });
  });

  describe('H2: signature image reference', () => {
    it.each(['https://evil.example/x.png', '../other/sig.png', '/etc/passwd', 'signatures/../x.png', 'media/abc.png', 'javascript:alert(1)'])('rejects %s', async (imageRef) => {
      const f = await pendingRequest(svc, 'rv-ref');
      await expect(svc.submitRequest(f.parent, f.req.id, { answers: validAnswers(), signature: validSignature({ imageRef }) }, META, NOW)).rejects.toBeInstanceOf(BadRequestException);
      expect(await db.formSubmission.count({ where: { requestId: f.req.id } })).toBe(0);
    });
  });

  it('M3: an oversized user-agent is truncated before it is stored', async () => {
    const f = await pendingRequest(svc, 'rv-ua');
    const out = await svc.submitRequest(f.parent, f.req.id, { answers: validAnswers(), signature: validSignature() }, { ip: META.ip, userAgent: 'x'.repeat(5000) }, NOW);
    expect((await db.formSubmission.findUniqueOrThrow({ where: { id: out.id } })).userAgent).toHaveLength(512);
  });

  it('M2: updating a template is audited with field names only', async () => {
    const f = await setupFamily('rv-upd');
    const t = await svc.createTemplate(f.admin, { title: 'T', fields: allFields() }, NOW);
    await svc.updateTemplate(f.admin, t.id, { title: 'SecretNewTitleXyz' }, NOW);
    const rows = (await auditFor(t.id)).filter((r) => r.action === 'forms.template_updated');
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toMatch(/SecretNewTitleXyz/);
  });

  it('M4: a signed request cannot be set back to PENDING in the database', async () => {
    const f = await pendingRequest(svc, 'rv-status');
    await svc.submitRequest(f.parent, f.req.id, { answers: validAnswers(), signature: validSignature() }, META, NOW);
    await expect(db.$executeRawUnsafe(`UPDATE form_requests SET status = 'PENDING' WHERE id = '${f.req.id}'`)).rejects.toThrow();
  });

  it('L1: listRequests rejects a childId that is not a UUID string', async () => {
    const f = await setupFamily('rv-childid');
    await expect(svc.listRequests(f.admin, { childId: { contains: 'x' } as any }, NOW)).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])('L2: a field keyed %s is rejected', async (key) => {
    const f = await setupFamily('rv-key');
    await expect(svc.createTemplate(f.admin, { title: 'T', fields: [{ key, type: 'text', label: 'L' }] }, NOW)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('U4c forms: send to all guardians of chosen children', () => {
  let svc: any;
  beforeAll(async () => {
    svc = (await buildForms()).service;
  });
  afterAll(async () => {
    await disconnectAll();
  });

  it('childIds expands to every current, unrestricted parent or guardian of each child', async () => {
    const f = await setupFamily('rv-childids');
    const second = await makeUser(f.tenant, 'PARENT');
    await link(f.tenant, second, f.child.id);
    const restricted = await makeUser(f.tenant, 'PARENT');
    await link(f.tenant, restricted, f.child.id, { isRestricted: true });
    const { templateId, version } = await publishedTemplate(svc, f.admin);
    const out = await svc.sendRequests(f.admin, { templateId, version, childIds: [f.child.id] }, NOW);
    expect(out).toHaveLength(2);
    const rows = await db.formRequest.findMany({ where: { templateId } });
    expect(rows.map((r: any) => r.guardianUserId).sort()).toEqual([f.parent.userId, second.userId].sort());
  });

  it('a child with no eligible guardian is a BadRequest and nothing is created; other centres children are refused', async () => {
    const f = await setupFamily('rv-childids-none');
    const lonely = await makeChild(f.tenant);
    const other = await setupFamily('rv-childids-other');
    const { templateId, version } = await publishedTemplate(svc, f.admin);
    await expect(svc.sendRequests(f.admin, { templateId, version, childIds: [lonely.id] }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.sendRequests(f.admin, { templateId, version, childIds: [other.child.id] }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    expect(await db.formRequest.count({ where: { templateId } })).toBe(0);
  });
});
