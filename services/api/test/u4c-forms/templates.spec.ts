import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { disconnectAll } from '../test-utils';
import { NOW, allFields, auditFor, buildForms, db, expectNoInternals, makeUser, publishedTemplate, setupFamily } from './helpers';

describe('U4c forms: templates', () => {
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

  describe('createTemplate', () => {
    it('creates a draft with the documented shape, scoped to the admin centre', async () => {
      const f = await setupFamily('ft-create');
      const t = await svc.createTemplate(f.admin, { title: '  Excursion  ', description: 'Desc', fields: allFields() }, NOW);
      expect(t).toMatchObject({ title: 'Excursion', description: 'Desc', status: 'DRAFT', latestVersion: null });
      expect(t.id).toBeTruthy();
      expect(t.fields).toHaveLength(6);
      expectNoInternals(t);
      const row = await db.formTemplate.findUniqueOrThrow({ where: { id: t.id } });
      expect(row.centreId).toBe(f.tenant.centreId);
      expect(row.orgId).toBe(f.tenant.orgId);
    });

    it('ORG_ADMIN can create at their centre', async () => {
      const f = await setupFamily('ft-orgadmin');
      const orgAdmin = await makeUser(f.tenant, 'ORG_ADMIN');
      await expect(svc.createTemplate(orgAdmin, { title: 'T', fields: allFields() }, NOW)).resolves.toMatchObject({ status: 'DRAFT' });
    });

    it.each(['educator', 'parent'] as const)('%s is Forbidden and nothing is written', async (who) => {
      const f = await setupFamily(`ft-forbid-${who}`);
      await expect(svc.createTemplate((f as any)[who], { title: 'T', fields: allFields() }, NOW)).rejects.toBeInstanceOf(ForbiddenException);
      expect(await db.formTemplate.count({ where: { centreId: f.tenant.centreId } })).toBe(0);
    });

    it.each([
      ['empty', ''],
      ['blank', '   '],
      ['over 200 chars', 'x'.repeat(201)],
    ])('rejects a %s title', async (_n, title) => {
      const f = await setupFamily('ft-title');
      await expect(svc.createTemplate(f.admin, { title, fields: allFields() }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a description over 2000 chars', async () => {
      const f = await setupFamily('ft-desc');
      await expect(svc.createTemplate(f.admin, { title: 'T', description: 'd'.repeat(2001), fields: allFields() }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    });

    describe('field validation', () => {
      const bad: Array<[string, any]> = [
        ['not an array', 'nope'],
        ['unknown type', [{ key: 'a', type: 'rating', label: 'A' }]],
        ['missing key', [{ type: 'text', label: 'A' }]],
        ['blank label', [{ key: 'a', type: 'text', label: '  ' }]],
        ['bad key characters', [{ key: 'has space!', type: 'text', label: 'A' }]],
        ['duplicate keys', [{ key: 'a', type: 'text', label: 'A' }, { key: 'a', type: 'date', label: 'B' }]],
        ['choice without options', [{ key: 'c', type: 'choice', label: 'C' }]],
        ['choice with one option', [{ key: 'c', type: 'choice', label: 'C', options: ['only'] }]],
        ['choice with duplicate options', [{ key: 'c', type: 'choice', label: 'C', options: ['a', 'a'] }]],
        ['choice with a blank option', [{ key: 'c', type: 'choice', label: 'C', options: ['a', ' '] }]],
        ['options on a non-choice field', [{ key: 't', type: 'text', label: 'T', options: ['a', 'b'] }]],
        ['two signature fields', [{ key: 's1', type: 'signature', label: 'S1' }, { key: 's2', type: 'signature', label: 'S2' }]],
        ['label over 200 chars', [{ key: 'a', type: 'text', label: 'l'.repeat(201) }]],
      ];
      it.each(bad)('rejects %s and writes nothing', async (_n, fields) => {
        const f = await setupFamily('ft-fields');
        await expect(svc.createTemplate(f.admin, { title: 'T', fields }, NOW)).rejects.toBeInstanceOf(BadRequestException);
        expect(await db.formTemplate.count({ where: { centreId: f.tenant.centreId } })).toBe(0);
      });

      it('accepts an empty draft (fields []) and exactly 50 fields, rejects 51', async () => {
        const f = await setupFamily('ft-count');
        await expect(svc.createTemplate(f.admin, { title: 'Draft', fields: [] }, NOW)).resolves.toMatchObject({ status: 'DRAFT' });
        const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `f${i}`, type: 'text', label: `Field ${i}` }));
        await expect(svc.createTemplate(f.admin, { title: 'Max', fields: mk(50) }, NOW)).resolves.toBeDefined();
        await expect(svc.createTemplate(f.admin, { title: 'Over', fields: mk(51) }, NOW)).rejects.toBeInstanceOf(BadRequestException);
      });
    });

    it('audits forms.template_created with ids/counts only, never the title, description or labels', async () => {
      const f = await setupFamily('ft-audit');
      const fields = [{ key: 'q', type: 'text', label: 'SecretLabelXyz' }];
      const t = await svc.createTemplate(f.admin, { title: 'SecretTitleXyz', description: 'SecretDescXyz', fields }, NOW);
      const rows = (await auditFor(t.id)).filter((r) => r.action === 'forms.template_created');
      expect(rows).toHaveLength(1);
      expect(rows[0].entityType).toBe('FormTemplate');
      expect(rows[0].actorUserId).toBe(f.admin.userId);
      expect(rows[0].centreId).toBe(f.tenant.centreId);
      expect(JSON.stringify(rows[0])).not.toMatch(/SecretTitleXyz|SecretDescXyz|SecretLabelXyz/);
    });

    it('rolls the template back when the audit write fails (same transaction)', async () => {
      const f = await setupFamily('ft-tx');
      jest.spyOn(h.audit, 'record').mockRejectedValue(new Error('audit down'));
      await expect(svc.createTemplate(f.admin, { title: 'T', fields: allFields() }, NOW)).rejects.toThrow();
      expect(await db.formTemplate.count({ where: { centreId: f.tenant.centreId } })).toBe(0);
    });
  });

  describe('updateTemplate (edits the working draft only)', () => {
    it('applies a partial update to a draft', async () => {
      const f = await setupFamily('fu-draft');
      const t = await svc.createTemplate(f.admin, { title: 'Old', fields: allFields() }, NOW);
      const out = await svc.updateTemplate(f.admin, t.id, { title: ' New ' }, NOW);
      expect(out).toMatchObject({ id: t.id, title: 'New', status: 'DRAFT' });
      expect(out.fields).toHaveLength(6);
    });

    it('validates fields on update with the same rules', async () => {
      const f = await setupFamily('fu-validate');
      const t = await svc.createTemplate(f.admin, { title: 'T', fields: allFields() }, NOW);
      await expect(svc.updateTemplate(f.admin, t.id, { fields: [{ key: 'a', type: 'bogus', label: 'A' }] }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('editing a published template never mutates the published version; it makes a new unpublished draft', async () => {
      const f = await setupFamily('fu-published');
      const { templateId, version } = await publishedTemplate(svc, f.admin);
      const edited = await svc.updateTemplate(f.admin, templateId, { title: 'Edited title', fields: [{ key: 'only', type: 'text', label: 'Only' }] }, NOW);
      expect(edited).toMatchObject({ status: 'DRAFT', latestVersion: version, title: 'Edited title' });
      const published = await svc.getTemplateVersion(f.admin, templateId, version);
      expect(published.title).toBe('Excursion consent');
      expect(published.fields).toHaveLength(6);
      expect(await db.formTemplateVersion.count({ where: { templateId } })).toBe(1);
    });

    it.each(['educator', 'parent'] as const)('%s is Forbidden', async (who) => {
      const f = await setupFamily(`fu-forbid-${who}`);
      const t = await svc.createTemplate(f.admin, { title: 'Orig', fields: allFields() }, NOW);
      await expect(svc.updateTemplate((f as any)[who], t.id, { title: 'Hacked' }, NOW)).rejects.toBeInstanceOf(ForbiddenException);
      expect((await db.formTemplate.findUniqueOrThrow({ where: { id: t.id } })).title).toBe('Orig');
    });

    it('unknown id and other-centre/org templates are NotFound and unchanged', async () => {
      const a = await setupFamily('fu-iso-a');
      const b = await setupFamily('fu-iso-b');
      const theirs = await svc.createTemplate(b.admin, { title: 'Theirs', fields: allFields() }, NOW);
      await expect(svc.updateTemplate(a.admin, '00000000-0000-0000-0000-000000000000', { title: 'x' }, NOW)).rejects.toBeInstanceOf(NotFoundException);
      await expect(svc.updateTemplate(a.admin, theirs.id, { title: 'Hacked' }, NOW)).rejects.toBeInstanceOf(NotFoundException);
      await expect(svc.publishTemplate(a.admin, theirs.id, NOW)).rejects.toBeInstanceOf(NotFoundException);
      await expect(svc.getTemplate(a.admin, theirs.id)).rejects.toBeInstanceOf(NotFoundException);
      expect((await db.formTemplate.findUniqueOrThrow({ where: { id: theirs.id } })).title).toBe('Theirs');
    });
  });

  describe('publishTemplate', () => {
    it('creates immutable version 1 with a snapshot of title, description and fields', async () => {
      const f = await setupFamily('fp-v1');
      const t = await svc.createTemplate(f.admin, { title: 'T1', description: 'D1', fields: allFields() }, NOW);
      const v = await svc.publishTemplate(f.admin, t.id, NOW);
      expect(v).toMatchObject({ templateId: t.id, version: 1, title: 'T1', description: 'D1' });
      expect(v.fields).toHaveLength(6);
      expectNoInternals(v);
      expect(await svc.getTemplate(f.admin, t.id)).toMatchObject({ status: 'PUBLISHED', latestVersion: 1 });
    });

    it('version numbers increment per template and are independent across templates', async () => {
      const f = await setupFamily('fp-incr');
      const a = await publishedTemplate(svc, f.admin);
      const b = await publishedTemplate(svc, f.admin);
      await svc.updateTemplate(f.admin, a.templateId, { title: 'A2' }, NOW);
      const v2 = await svc.publishTemplate(f.admin, a.templateId, NOW);
      await svc.updateTemplate(f.admin, a.templateId, { title: 'A3' }, NOW);
      const v3 = await svc.publishTemplate(f.admin, a.templateId, NOW);
      expect([a.version, v2.version, v3.version, b.version]).toEqual([1, 2, 3, 1]);
      expect((await svc.getTemplateVersion(f.admin, a.templateId, 1)).title).toBe('Excursion consent');
      expect((await svc.getTemplateVersion(f.admin, a.templateId, 2)).title).toBe('A2');
    });

    it('rejects publishing a template with no fields, and re-publishing with no changes', async () => {
      const f = await setupFamily('fp-empty');
      const empty = await svc.createTemplate(f.admin, { title: 'Empty', fields: [] }, NOW);
      await expect(svc.publishTemplate(f.admin, empty.id, NOW)).rejects.toBeInstanceOf(BadRequestException);
      const { templateId } = await publishedTemplate(svc, f.admin);
      await expect(svc.publishTemplate(f.admin, templateId, NOW)).rejects.toBeInstanceOf(Error);
      expect(await db.formTemplateVersion.count({ where: { templateId } })).toBe(1);
    });

    it('concurrent publishes of one draft never produce a duplicate version number', async () => {
      const f = await setupFamily('fp-race');
      const { templateId } = await publishedTemplate(svc, f.admin);
      await svc.updateTemplate(f.admin, templateId, { title: 'Race' }, NOW);
      await Promise.allSettled([svc.publishTemplate(f.admin, templateId, NOW), svc.publishTemplate(f.admin, templateId, NOW)]);
      const versions = (await db.formTemplateVersion.findMany({ where: { templateId } })).map((v: any) => v.version).sort();
      expect(versions).toEqual([1, 2]);
    });

    it.each(['educator', 'parent'] as const)('%s is Forbidden and no version is created', async (who) => {
      const f = await setupFamily(`fp-forbid-${who}`);
      const t = await svc.createTemplate(f.admin, { title: 'T', fields: allFields() }, NOW);
      await expect(svc.publishTemplate((f as any)[who], t.id, NOW)).rejects.toBeInstanceOf(ForbiddenException);
      expect(await db.formTemplateVersion.count({ where: { templateId: t.id } })).toBe(0);
    });

    it('audits forms.template_published with version and counts only, in the same transaction', async () => {
      const f = await setupFamily('fp-audit');
      const t = await svc.createTemplate(f.admin, { title: 'SecretTitleXyz', fields: [{ key: 'q', type: 'text', label: 'SecretLabelXyz' }] }, NOW);
      await svc.publishTemplate(f.admin, t.id, NOW);
      const rows = (await auditFor(t.id)).filter((r) => r.action === 'forms.template_published');
      expect(rows).toHaveLength(1);
      expect(rows[0].entityType).toBe('FormTemplate');
      expect(JSON.stringify(rows[0].metadata)).toMatch(/version/);
      expect(JSON.stringify(rows[0])).not.toMatch(/SecretTitleXyz|SecretLabelXyz/);

      const t2 = await svc.createTemplate(f.admin, { title: 'T2', fields: allFields() }, NOW);
      jest.spyOn(h.audit, 'record').mockRejectedValue(new Error('audit down'));
      await expect(svc.publishTemplate(f.admin, t2.id, NOW)).rejects.toThrow();
      expect(await db.formTemplateVersion.count({ where: { templateId: t2.id } })).toBe(0);
    });
  });

  describe('reads', () => {
    it('listTemplates is admin-only and centre-scoped', async () => {
      const a = await setupFamily('fl-a');
      const b = await setupFamily('fl-b');
      const mine = await svc.createTemplate(a.admin, { title: 'Mine', fields: allFields() }, NOW);
      await svc.createTemplate(b.admin, { title: 'Theirs', fields: allFields() }, NOW);
      const list = await svc.listTemplates(a.admin, NOW);
      expect(list.map((t: any) => t.id)).toEqual([mine.id]);
      expectNoInternals(list);
      await expect(svc.listTemplates(a.educator, NOW)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.listTemplates(a.parent, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
