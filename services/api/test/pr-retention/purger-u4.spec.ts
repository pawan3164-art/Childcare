import { RetentionPurger } from '../../src/retention/retention-purger';
import { InMemoryObjectStorage } from '../../src/media/storage/in-memory-object-storage';
import { appPrisma, disconnectAll, fixturePrisma, seedOrgCentreRoom, SeededTenant } from '../test-utils';
import { childRow, db, ELIGIBLE_7Y, makeChild, makeUser, NOT_YET_7Y, NOW } from './helpers';

/** Retention of the U4 tables: health records (allergies, immunisations, status) and signed forms. */
describe('PR retention: health and forms records (OI-41)', () => {
  const purger = new RetentionPurger(fixturePrisma, new InMemoryObjectStorage());

  afterAll(async () => {
    await disconnectAll();
  });

  async function seedU4(t: SeededTenant, childId: string) {
    const { orgId, centreId } = t;
    const admin = await makeUser(t, 'CENTRE_ADMIN');
    const guardian = await makeUser(t, 'PARENT');
    await db.childAllergy.create({ data: { orgId, centreId, childId, allergen: 'Peanut-secret', severity: 'SEVERE', recordedByUserId: admin.userId } });
    await db.childAllergy.create({
      data: { orgId, centreId, childId, allergen: 'Egg-secret', severity: 'MILD', recordedByUserId: admin.userId, endedAt: new Date(), endedByUserId: admin.userId, endReason: 'outgrown' },
    });
    await db.childImmunisation.create({ data: { orgId, centreId, childId, vaccine: 'MMR-secret', doseDate: new Date('2018-01-01'), source: 'PARENT_DECLARED', recordedByUserId: admin.userId } });
    await db.childImmunisationStatus.create({ data: { orgId, centreId, childId, status: 'UP_TO_DATE', updatedByUserId: admin.userId } });
    const tpl = await db.formTemplate.create({ data: { orgId, centreId, title: 'Excursion', fields: [], createdByUserId: admin.userId } });
    const request = await db.formRequest.create({
      data: { orgId, centreId, templateId: tpl.id, templateVersion: 1, childId, guardianUserId: guardian.userId, status: 'SIGNED', createdByUserId: admin.userId },
    });
    await db.formSubmission.create({
      data: {
        orgId, centreId, requestId: request.id, templateId: tpl.id, templateVersion: 1, childId, guardianUserId: guardian.userId,
        answers: { q: 'answer-secret' }, answersHash: 'h', signerTypedName: 'Signer Secret', consentGiven: true, signedAt: new Date(), ip: '203.0.113.9', userAgent: 'UA-secret',
      },
    });
    await db.formSignature.create({ data: { orgId, centreId, requestId: request.id, guardianUserId: guardian.userId, strokes: [[[0, 0]]] } });
    return { requestId: request.id };
  }

  const u4Counts = async (childId: string, requestId: string) => ({
    allergies: await db.childAllergy.count({ where: { childId } }),
    immunisations: await db.childImmunisation.count({ where: { childId } }),
    status: await db.childImmunisationStatus.count({ where: { childId } }),
    requests: await db.formRequest.count({ where: { childId } }),
    submissions: await db.formSubmission.count({ where: { childId } }),
    signatures: await db.formSignature.count({ where: { requestId } }),
  });
  const affected = (res: any, childId: string, type: string) => res.results.find((r: any) => r.childId === childId && r.recordType === type)?.affected ?? 0;

  it('dry run counts health and forms rows and deletes nothing', async () => {
    const t = await seedOrgCentreRoom('purge-u4-dry');
    const kid = await makeChild(t, { departedOn: ELIGIBLE_7Y });
    const { requestId } = await seedU4(t, kid.id);
    const before = await u4Counts(kid.id, requestId);

    const res = await purger.run(NOW, { orgId: t.orgId });

    expect(res.notAutomated).not.toContain('health');
    expect(res.notAutomated).not.toContain('forms');
    expect(affected(res, kid.id, 'health')).toBe(4);
    expect(affected(res, kid.id, 'forms')).toBe(3);
    expect(await u4Counts(kid.id, requestId)).toEqual(before);
  });

  it('execute deletes health and forms rows (including immutable submissions) and anonymises the child', async () => {
    const t = await seedOrgCentreRoom('purge-u4-exec');
    const kid = await makeChild(t, { departedOn: ELIGIBLE_7Y });
    const { requestId } = await seedU4(t, kid.id);

    await purger.run(NOW, { orgId: t.orgId, execute: true });

    expect(await u4Counts(kid.id, requestId)).toEqual({ allergies: 0, immunisations: 0, status: 0, requests: 0, submissions: 0, signatures: 0 });
    expect((await childRow(kid.id)).anonymisedAt).toEqual(NOW);
    const entries = await fixturePrisma.auditLogEntry.findMany({ where: { entityId: kid.id, action: 'retention.purged' } });
    const json = JSON.stringify(entries);
    for (const secret of ['Peanut-secret', 'Egg-secret', 'MMR-secret', 'answer-secret', 'Signer Secret', 'UA-secret', '203.0.113.9']) expect(json).not.toContain(secret);
    expect(entries.map((e) => (e.metadata as any).recordType)).toEqual(expect.arrayContaining(['health', 'forms']));
  });

  it('keeps everything, and does not anonymise, while the child is not yet due', async () => {
    const t = await seedOrgCentreRoom('purge-u4-notyet');
    const kid = await makeChild(t, { departedOn: NOT_YET_7Y });
    const { requestId } = await seedU4(t, kid.id);
    const before = await u4Counts(kid.id, requestId);
    await purger.run(NOW, { orgId: t.orgId, execute: true });
    expect(await u4Counts(kid.id, requestId)).toEqual(before);
    expect((await childRow(kid.id)).anonymisedAt).toBeNull();
  });

  it('keeps health and forms for a child on legal hold', async () => {
    const t = await seedOrgCentreRoom('purge-u4-hold');
    const kid = await makeChild(t, { departedOn: ELIGIBLE_7Y, legalHold: true, legalHoldReason: 'dispute' });
    const { requestId } = await seedU4(t, kid.id);
    const before = await u4Counts(kid.id, requestId);
    await purger.run(NOW, { orgId: t.orgId, execute: true });
    expect(await u4Counts(kid.id, requestId)).toEqual(before);
  });

  it('the web API role still cannot delete signed submissions or health rows', async () => {
    const t = await seedOrgCentreRoom('purge-u4-appcannot');
    const kid = await makeChild(t, { departedOn: ELIGIBLE_7Y });
    await seedU4(t, kid.id);
    await expect(appPrisma.$executeRawUnsafe(`DELETE FROM form_submissions WHERE child_id = '${kid.id}'`)).rejects.toThrow();
    await expect(appPrisma.$executeRawUnsafe(`DELETE FROM child_allergies WHERE child_id = '${kid.id}'`)).rejects.toThrow();
  });
});
