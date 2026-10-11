import { RetentionPurger } from '../../src/retention/retention-purger';
import { RetentionService } from '../../src/retention/retention.service';
import { InMemoryObjectStorage } from '../../src/media/storage/in-memory-object-storage';
import { appPrisma, disconnectAll, fixturePrisma, seedOrgCentreRoom, setTenantContext } from '../test-utils';
import { buildServices, childRow, counts, db, ELIGIBLE_7Y, makeChild, makeUser, NOT_YET_7Y, NOW, seedContent } from './helpers';

const NOT_AUTOMATED = ['audit_logs', 'billing', 'incidents', 'learning', 'medication'];

class FlakyStorage extends InMemoryObjectStorage {
  failKeys = new Set<string>();
  async delete(key: string): Promise<void> {
    if (this.failKeys.has(key)) throw new Error('storage unavailable');
    return super.delete(key);
  }
}

describe('PR retention: RetentionPurger (RET-002, RET-003, RET-005)', () => {
  let prismaService: any;
  let retention: RetentionService;
  let storage: FlakyStorage;
  let purger: RetentionPurger;

  beforeAll(async () => {
    const s = await buildServices();
    prismaService = s.prismaService;
    retention = new RetentionService(s.tenancy, s.audit, s.authorization);
  });

  beforeEach(() => {
    storage = new FlakyStorage();
    purger = new RetentionPurger(fixturePrisma, storage);
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy?.();
    await disconnectAll();
  });

  async function fresh(label: string) {
    const tenant = await seedOrgCentreRoom(label);
    return tenant;
  }

  const purgeAudit = (childId: string) => fixturePrisma.auditLogEntry.findMany({ where: { entityId: childId, action: 'retention.purged' } });
  const allAudit = (childId: string) => fixturePrisma.auditLogEntry.findMany({ where: { entityId: childId } });
  const affectedFor = (res: { results: { childId: string; recordType: string; affected: number }[] }, childId: string, type: string) =>
    res.results.find((r) => r.childId === childId && r.recordType === type)?.affected ?? 0;

  describe('dry run', () => {
    it('is the default: reports what would be affected and changes nothing', async () => {
      const t = await fresh('purge-dry');
      const kid = await makeChild(t, { departedOn: ELIGIBLE_7Y });
      const content = await seedContent(t, kid.id, storage);
      const before = await counts(kid.id);
      const auditBefore = await allAudit(kid.id);

      const res = await purger.run(NOW, { orgId: t.orgId });

      expect(res.dryRun).toBe(true);
      expect([...res.notAutomated].sort()).toEqual(NOT_AUTOMATED);
      expect(affectedFor(res, kid.id, 'attendance')).toBe(2);
      expect(affectedFor(res, kid.id, 'care_records')).toBe(2);
      expect(affectedFor(res, kid.id, 'media')).toBe(1);
      expect(affectedFor(res, kid.id, 'messages')).toBeGreaterThan(0);
      expect(await counts(kid.id)).toEqual(before);
      expect(await allAudit(kid.id)).toEqual(auditBefore);
      expect(await purgeAudit(kid.id)).toHaveLength(0);
      expect(storage.get(content.mediaKey)).toBeDefined();
      expect((await childRow(kid.id)).anonymisedAt).toBeNull();
    });

    it('explicit execute:false is also a dry run', async () => {
      const t = await fresh('purge-dry2');
      const kid = await makeChild(t, { departedOn: ELIGIBLE_7Y });
      await seedContent(t, kid.id, storage);
      const before = await counts(kid.id);
      const res = await purger.run(NOW, { orgId: t.orgId, execute: false });
      expect(res.dryRun).toBe(true);
      expect(await counts(kid.id)).toEqual(before);
    });
  });

  describe('execute', () => {
    it('purges eligible content, anonymises the child, keeps billing, medication, incidents and audit', async () => {
      const t = await fresh('purge-exec');
      const kid = await makeChild(t, { departedOn: ELIGIBLE_7Y, dob: '2016-05-20', legalHoldReason: undefined });
      const c = await seedContent(t, kid.id, storage);
      const admin = await makeUser(t, 'CENTRE_ADMIN');
      await fixturePrisma.auditLogEntry.create({
        data: { orgId: t.orgId, centreId: t.centreId, actorUserId: admin.userId, action: 'child.departed', entityType: 'Child', entityId: kid.id, outcome: 'SUCCESS', metadata: {} },
      });
      const auditCountBefore = (await allAudit(kid.id)).length;

      const res = await purger.run(NOW, { orgId: t.orgId, execute: true });

      expect(res.dryRun).toBe(false);
      expect([...res.notAutomated].sort()).toEqual(NOT_AUTOMATED);
      const after = await counts(kid.id);
      expect(after).toMatchObject({ attendance: 0, care: 0, threads: 0, messages: 0, tags: 0, relationships: 0, pickups: 0, casuals: 0 });
      // Retained, never automated, or billing data.
      expect(after).toMatchObject({ medication: 1, incidents: 1, ledger: 1, invoices: 1, absences: 1, bookings: 1 });
      expect(await fixturePrisma.mediaAsset.findUnique({ where: { id: c.mediaAssetId } })).toBeNull();
      expect(storage.get(c.mediaKey)).toBeUndefined();

      const row = await childRow(kid.id);
      expect(row.firstName).toBe('Former');
      expect(row.lastName).toBe('child');
      expect(row.dateOfBirth.toISOString().slice(0, 10)).toBe('2016-01-01');
      expect(row.legalHoldReason).toBeNull();
      expect(row.roomId).toBeNull();
      expect(row.anonymisedAt).toEqual(NOW);

      // Pre-existing audit rows survive; purge entries are added on top.
      expect((await allAudit(kid.id)).length).toBeGreaterThan(auditCountBefore);
      expect(await fixturePrisma.auditLogEntry.count({ where: { entityId: kid.id, action: 'child.departed' } })).toBe(1);
    });

    it('writes one audit entry per child and record type with counts only, actor null', async () => {
      const t = await fresh('purge-audit');
      const kid = await makeChild(t, { departedOn: ELIGIBLE_7Y });
      const c = await seedContent(t, kid.id, storage);
      await purger.run(NOW, { orgId: t.orgId, execute: true });

      const entries = await purgeAudit(kid.id);
      const types = entries.map((e) => (e.metadata as any).recordType).sort();
      expect(new Set(types).size).toBe(types.length); // one per record type
      expect(types).toEqual(expect.arrayContaining(['attendance', 'care_records', 'media', 'messages', 'enrolment']));
      for (const t2 of types) expect(NOT_AUTOMATED).not.toContain(t2);
      for (const e of entries) {
        expect(e.actorUserId).toBeNull();
        expect(e.entityType).toBe('Child');
        expect(e.orgId).toBe(t.orgId);
        expect(Object.keys(e.metadata as object).sort()).toEqual(['affected', 'recordType']);
        expect((e.metadata as any).affected).toBeGreaterThan(0);
        const json = JSON.stringify(e);
        for (const secret of [kid.firstName, kid.lastName, c.mediaKey, 'Secret meal note', 'private message text', 'Aunt Pat', '0400111222']) {
          expect(json).not.toContain(secret);
        }
      }
      const att = entries.find((e) => (e.metadata as any).recordType === 'attendance');
      expect((att!.metadata as any).affected).toBe(2);
    });

    it('is idempotent: a second execute affects nothing and audits nothing', async () => {
      const t = await fresh('purge-idem');
      const kid = await makeChild(t, { departedOn: ELIGIBLE_7Y });
      await seedContent(t, kid.id, storage);
      await purger.run(NOW, { orgId: t.orgId, execute: true });
      const auditAfterFirst = await purgeAudit(kid.id);
      const countsAfterFirst = await counts(kid.id);
      const anonAt = (await childRow(kid.id)).anonymisedAt;

      const second = await purger.run(new Date(NOW.getTime() + 86_400_000), { orgId: t.orgId, execute: true });
      expect(second.results.reduce((n, r) => n + r.affected, 0)).toBe(0);
      expect((await purgeAudit(kid.id)).length).toBe(auditAfterFirst.length);
      expect(await counts(kid.id)).toEqual(countsAfterFirst);
      expect((await childRow(kid.id)).anonymisedAt).toEqual(anonAt);
    });
  });

  describe('who is left alone', () => {
    it('children on legal hold, not departed, or not yet past retention are untouched', async () => {
      const t = await fresh('purge-untouched');
      const held = await makeChild(t, { departedOn: ELIGIBLE_7Y, legalHold: true, legalHoldReason: 'dispute' });
      const active = await makeChild(t, { departedOn: null });
      const notYet = await makeChild(t, { departedOn: NOT_YET_7Y });
      const due = await makeChild(t, { departedOn: ELIGIBLE_7Y });
      const ids = [held.id, active.id, notYet.id];
      for (const id of [...ids, due.id]) await seedContent(t, id, storage);
      const before = await Promise.all(ids.map((id) => counts(id)));
      const rowsBefore = await Promise.all(ids.map((id) => childRow(id)));

      const res = await purger.run(NOW, { orgId: t.orgId, execute: true });

      expect(await Promise.all(ids.map((id) => counts(id)))).toEqual(before);
      expect(await Promise.all(ids.map((id) => childRow(id)))).toEqual(rowsBefore);
      for (const id of ids) {
        expect(res.results.filter((r) => r.childId === id)).toEqual([]);
        expect(await purgeAudit(id)).toHaveLength(0);
      }
      expect((await counts(due.id)).attendance).toBe(0);
    });

    it('evaluates eligibility in the centre timezone', async () => {
      const t = await fresh('purge-tz');
      await fixturePrisma.centre.update({ where: { id: t.centreId }, data: { timezone: 'America/Los_Angeles' } });
      const kid = await makeChild(t, { departedOn: ELIGIBLE_7Y }); // local date there at NOW is 2026-10-13
      await seedContent(t, kid.id, storage);
      const before = await counts(kid.id);
      await purger.run(NOW, { orgId: t.orgId, execute: true });
      expect(await counts(kid.id)).toEqual(before);
      await purger.run(new Date('2026-10-14T20:00:00Z'), { orgId: t.orgId, execute: true });
      expect((await counts(kid.id)).attendance).toBe(0);
    });

    it('a centre override delays one type, and anonymisation waits for all four content types', async () => {
      const t = await fresh('purge-override');
      const admin = await makeUser(t, 'CENTRE_ADMIN');
      await retention.setRetentionOverride(admin, 'attendance', 10);
      const kid = await makeChild(t, { departedOn: ELIGIBLE_7Y });
      await seedContent(t, kid.id, storage);

      await purger.run(NOW, { orgId: t.orgId, execute: true });

      const after = await counts(kid.id);
      expect(after.attendance).toBe(2);
      expect(after.care).toBe(0);
      expect(after.messages).toBe(0);
      const row = await childRow(kid.id);
      expect(row.anonymisedAt).toBeNull();
      expect(row.firstName).toBe(kid.firstName);
      expect(after.relationships).toBe(1);
      expect(after.pickups).toBe(1);
      expect(after.casuals).toBe(1);
    });
  });

  describe('shared media', () => {
    async function sharedAsset(t: Awaited<ReturnType<typeof fresh>>, childIds: string[]) {
      const guardian = await makeUser(t, 'PARENT');
      const key = `retention/shared/${Date.now()}-${Math.random()}.jpg`;
      const asset = await fixturePrisma.mediaAsset.create({
        data: { orgId: t.orgId, centreId: t.centreId, storageKey: key, contentType: 'image/jpeg', byteSize: 3, capturedByUserId: guardian.userId },
      });
      for (const childId of childIds) await fixturePrisma.mediaAssetChildTag.create({ data: { orgId: t.orgId, mediaAssetId: asset.id, childId } });
      await storage.put(key, Buffer.from('abc'), 'image/jpeg');
      return { asset, key };
    }

    it('keeps the asset and object while another tagged child is still within retention', async () => {
      const t = await fresh('purge-shared-keep');
      const gone = await makeChild(t, { departedOn: ELIGIBLE_7Y });
      const stays = await makeChild(t, { departedOn: NOT_YET_7Y });
      const { asset, key } = await sharedAsset(t, [gone.id, stays.id]);

      await purger.run(NOW, { orgId: t.orgId, execute: true });

      expect(await fixturePrisma.mediaAssetChildTag.count({ where: { mediaAssetId: asset.id, childId: gone.id } })).toBe(0);
      expect(await fixturePrisma.mediaAssetChildTag.count({ where: { mediaAssetId: asset.id, childId: stays.id } })).toBe(1);
      expect(await fixturePrisma.mediaAsset.findUnique({ where: { id: asset.id } })).not.toBeNull();
      expect(storage.get(key)).toBeDefined();
    });

    it('keeps it when the other tagged child is on legal hold or has not departed', async () => {
      const t = await fresh('purge-shared-hold');
      const gone = await makeChild(t, { departedOn: ELIGIBLE_7Y });
      const held = await makeChild(t, { departedOn: ELIGIBLE_7Y, legalHold: true, legalHoldReason: 'x' });
      const active = await makeChild(t, { departedOn: null });
      const { asset, key } = await sharedAsset(t, [gone.id, held.id, active.id]);
      await purger.run(NOW, { orgId: t.orgId, execute: true });
      expect(await fixturePrisma.mediaAssetChildTag.count({ where: { mediaAssetId: asset.id } })).toBe(2);
      expect(storage.get(key)).toBeDefined();
    });

    it('removes asset, tags and object when every tagged child is eligible', async () => {
      const t = await fresh('purge-shared-all');
      const a = await makeChild(t, { departedOn: ELIGIBLE_7Y });
      const b = await makeChild(t, { departedOn: '2015-01-01' });
      const { asset, key } = await sharedAsset(t, [a.id, b.id]);
      await purger.run(NOW, { orgId: t.orgId, execute: true });
      expect(await fixturePrisma.mediaAsset.findUnique({ where: { id: asset.id } })).toBeNull();
      expect(await fixturePrisma.mediaAssetChildTag.count({ where: { mediaAssetId: asset.id } })).toBe(0);
      expect(storage.get(key)).toBeUndefined();
    });

    it('a storage failure skips that asset and the run carries on', async () => {
      const t = await fresh('purge-storage-fail');
      const kid = await makeChild(t, { departedOn: ELIGIBLE_7Y });
      const bad = await sharedAsset(t, [kid.id]);
      const good = await sharedAsset(t, [kid.id]);
      storage.failKeys.add(bad.key);
      const other = await makeChild(t, { departedOn: ELIGIBLE_7Y });
      await seedContent(t, other.id, storage);

      const res = await purger.run(NOW, { orgId: t.orgId, execute: true });

      expect(res.dryRun).toBe(false);
      // The failing asset stays in the database, with its tag and object, so a later run can retry.
      expect(await fixturePrisma.mediaAsset.findUnique({ where: { id: bad.asset.id } })).not.toBeNull();
      expect(await fixturePrisma.mediaAssetChildTag.count({ where: { mediaAssetId: bad.asset.id, childId: kid.id } })).toBe(1);
      expect(storage.get(bad.key)).toBeDefined();
      // The healthy asset and the other child are processed.
      expect(await fixturePrisma.mediaAsset.findUnique({ where: { id: good.asset.id } })).toBeNull();
      expect(storage.get(good.key)).toBeUndefined();
      expect((await counts(other.id)).attendance).toBe(0);

      // Recovery: once storage works, the next run finishes the job.
      storage.failKeys.clear();
      await purger.run(NOW, { orgId: t.orgId, execute: true });
      expect(await fixturePrisma.mediaAsset.findUnique({ where: { id: bad.asset.id } })).toBeNull();
      expect(storage.get(bad.key)).toBeUndefined();
    });
  });

  describe('organisation scope', () => {
    it('a run limited to one org never touches another org, which is processed on its own rules', async () => {
      const a = await fresh('purge-org-a');
      const b = await fresh('purge-org-b');
      const kidA = await makeChild(a, { departedOn: ELIGIBLE_7Y });
      const kidB = await makeChild(b, { departedOn: ELIGIBLE_7Y });
      await seedContent(a, kidA.id, storage);
      await seedContent(b, kidB.id, storage);
      const bBefore = await counts(kidB.id);

      await purger.run(NOW, { orgId: a.orgId, execute: true });
      expect((await counts(kidA.id)).attendance).toBe(0);
      expect(await counts(kidB.id)).toEqual(bBefore);
      expect((await childRow(kidB.id)).anonymisedAt).toBeNull();
      expect(await purgeAudit(kidB.id)).toHaveLength(0);

      await purger.run(NOW, { orgId: b.orgId, execute: true });
      expect((await counts(kidB.id)).attendance).toBe(0);
    });

    it('org B with a longer centre override is not purged by the same run that purges org A', async () => {
      const a = await fresh('purge-rules-a');
      const b = await fresh('purge-rules-b');
      const adminB = await makeUser(b, 'CENTRE_ADMIN');
      for (const type of ['attendance', 'care_records', 'media', 'messages']) await retention.setRetentionOverride(adminB, type, 12);
      const kidA = await makeChild(a, { departedOn: ELIGIBLE_7Y });
      const kidB = await makeChild(b, { departedOn: ELIGIBLE_7Y });
      await seedContent(a, kidA.id, storage);
      await seedContent(b, kidB.id, storage);
      const bBefore = await counts(kidB.id);
      await purger.run(NOW, { orgId: a.orgId, execute: true });
      await purger.run(NOW, { orgId: b.orgId, execute: true });
      expect((await counts(kidA.id)).attendance).toBe(0);
      expect(await counts(kidB.id)).toEqual(bBefore);
      expect((await childRow(kidB.id)).anonymisedAt).toBeNull();
    });
  });

  describe('the web API role cannot purge', () => {
    it('is denied DELETE on attendance_events and care_records', async () => {
      const t = await fresh('purge-rbac');
      const kid = await makeChild(t, { departedOn: ELIGIBLE_7Y });
      const c = await seedContent(t, kid.id);
      await setTenantContext(appPrisma, t.orgId, t.centreId);
      await expect(appPrisma.attendanceEvent.delete({ where: { id: c.attendanceIds[0] } })).rejects.toThrow(/permission denied/i);
      await expect(appPrisma.careRecord.delete({ where: { id: c.careIds[0] } })).rejects.toThrow(/permission denied/i);
      await expect(appPrisma.attendanceEvent.deleteMany({ where: { childId: kid.id } })).rejects.toThrow(/permission denied/i);
      expect((await counts(kid.id)).attendance).toBe(2);
      expect((await counts(kid.id)).care).toBe(2);
    });
  });

  it('keeps db helper usable for debugging (sanity)', () => {
    expect(db).toBe(fixturePrisma);
  });
});
