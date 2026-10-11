import { PrivacyService } from '../../src/privacy/privacy.service';
import { disconnectAll, fixturePrisma, seedOrgCentreRoom, uniqueSuffix } from '../test-utils';
import { auditFor, buildServices, link, makeChild, makeUser, NOW } from './helpers';

describe('PR retention: guardian data access export (APP 12)', () => {
  let service: PrivacyService;
  let prismaService: any;
  let t: Awaited<ReturnType<typeof seedOrgCentreRoom>>;
  let parentA: Awaited<ReturnType<typeof makeUser>>;
  let parentB: Awaited<ReturnType<typeof makeUser>>;
  let stranger: Awaited<ReturnType<typeof makeUser>>;
  let educator: Awaited<ReturnType<typeof makeUser>>;
  let admin: Awaited<ReturnType<typeof makeUser>>;
  let shared: any;
  let restrictedKid: any;
  let expiredKid: any;
  let strangerKid: any;
  let roomName: string;

  beforeAll(async () => {
    const s = await buildServices();
    prismaService = s.prismaService;
    service = new PrivacyService(s.tenancy, s.audit, s.authorization);
    t = await seedOrgCentreRoom('privacy');
    roomName = (await fixturePrisma.room.findUniqueOrThrow({ where: { id: t.roomId } })).name;
    parentA = await makeUser(t, 'PARENT', { firstName: 'Alice', lastName: 'Aardvark' });
    parentB = await makeUser(t, 'PARENT', { email: `co-guardian-bravo-${uniqueSuffix()}@example.test`, firstName: 'Bob', lastName: 'Bravo' });
    stranger = await makeUser(t, 'PARENT', { email: `stranger-sam-${uniqueSuffix()}@example.test` });
    educator = await makeUser(t, 'EDUCATOR', { roomId: t.roomId });
    admin = await makeUser(t, 'CENTRE_ADMIN');

    await fixturePrisma.user.update({ where: { id: parentA.userId }, data: { mfaSecret: 'MFASECRET-ALPHA-XYZ', mfaEnabled: true } });
    await fixturePrisma.user.update({ where: { id: parentB.userId }, data: { mfaSecret: 'MFASECRET-BRAVO-XYZ' } });

    shared = await makeChild(t);
    restrictedKid = await makeChild(t);
    expiredKid = await makeChild(t);
    strangerKid = await makeChild(t);
    await link(t, parentA, shared.id, { canPickup: true, canViewMedia: true, canViewBilling: true });
    await link(t, parentB, shared.id);
    await link(t, parentA, restrictedKid.id, { isRestricted: true });
    await link(t, parentA, expiredKid.id, { expiresAt: new Date(NOW.getTime() - 86_400_000) });
    await link(t, stranger, strangerKid.id);

    for (const child of [shared, restrictedKid, expiredKid, strangerKid]) {
      const { id: childId } = child;
      const base = { orgId: t.orgId, centreId: t.centreId, childId };
      await fixturePrisma.attendanceEvent.create({ data: { ...base, eventType: 'SIGN_IN', method: 'EDUCATOR', timestamp: new Date('2026-10-01T22:00:00Z') } });
      await fixturePrisma.careRecord.create({
        data: { ...base, type: 'MEAL', timestamp: new Date('2026-10-02T01:00:00Z'), note: `Meal note for ${childId}`, groupEventId: `g-${childId}`, recordedByUserId: educator.userId },
      });
      await fixturePrisma.absence.create({ data: { ...base, date: new Date('2026-10-05'), isAllowable: false, reason: `Sick ${childId}` } });
      await fixturePrisma.casualDayRequest.create({
        data: { ...base, date: new Date('2026-10-20'), note: `Extra day ${childId}`, requestedByUserId: educator.userId },
      });
      await fixturePrisma.pickupNomination.create({
        data: { ...base, date: new Date('2026-10-21'), personName: `Pickup ${childId.slice(0, 8)}`, personPhone: '0400999888', createdByUserId: educator.userId },
      });
      const invoice = await fixturePrisma.invoice.create({ data: { ...base, cycleStart: new Date('2026-10-01'), cycleEnd: new Date('2026-10-31') } });
      await fixturePrisma.ledgerEntry.create({
        data: { ...base, invoiceId: invoice.id, entryType: 'FEE', amountCents: 123457, description: 'Daily fee LEDGERMARKER' },
      });
    }
    await fixturePrisma.auditLogEntry.create({
      data: { orgId: t.orgId, actorUserId: parentA.userId, action: 'something.private', entityType: 'User', entityId: parentA.userId, outcome: 'SUCCESS', metadata: { marker: 'AUDITMARKER' } },
    });
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy?.();
    await disconnectAll();
  });

  it('returns the parent profile and only their visible children', async () => {
    const out = await service.exportMyData(parentA, NOW);
    expect(out.generatedAt).toBe(NOW.toISOString());
    expect(out.profile).toEqual({ id: parentA.userId, email: parentA.email, firstName: 'Alice', lastName: 'Aardvark', role: 'PARENT' });
    expect(out.children.map((c: any) => c.id)).toEqual([shared.id]);
  });

  it('includes the child record, relationship and the child data a guardian can see', async () => {
    const out = await service.exportMyData(parentA, NOW);
    const child = out.children[0];
    expect(child).toMatchObject({
      id: shared.id,
      firstName: shared.firstName,
      lastName: shared.lastName,
      dateOfBirth: shared.dateOfBirth.toISOString().slice(0, 10),
      roomName,
      relationship: { relationshipType: 'PARENT', canViewMedia: true, canViewBilling: true, canPickup: true },
    });
    expect(child.attendance).toEqual([{ eventType: 'SIGN_IN', timestamp: new Date('2026-10-01T22:00:00Z').toISOString() }]);
    expect(child.careRecords).toEqual([{ type: 'MEAL', timestamp: new Date('2026-10-02T01:00:00Z').toISOString(), note: `Meal note for ${shared.id}` }]);
    expect(child.absences).toEqual([{ date: '2026-10-05', isAllowable: false, reason: `Sick ${shared.id}` }]);
    expect(child.casualDayRequests).toEqual([{ date: '2026-10-20', status: 'PENDING', note: `Extra day ${shared.id}` }]);
    expect(child.pickupNominations).toEqual([
      { date: '2026-10-21', personName: `Pickup ${shared.id.slice(0, 8)}`, personPhone: '0400999888', status: 'ACTIVE', verified: false },
    ]);
  });

  it('leaves out credentials, secrets, other guardians, other families, billing and audit', async () => {
    const out = await service.exportMyData(parentA, NOW);
    const json = JSON.stringify(out);
    const a = await fixturePrisma.user.findUniqueOrThrow({ where: { id: parentA.userId } });
    expect(json).not.toContain(a.passwordHash);
    expect(json).not.toContain('MFASECRET-ALPHA-XYZ');
    expect(json).not.toContain('MFASECRET-BRAVO-XYZ');
    expect(json).not.toContain('passwordHash');
    expect(json).not.toContain('mfaSecret');
    expect(json).not.toContain('refresh');
    expect(json).not.toContain(parentB.email);
    expect(json).not.toContain('Bravo');
    expect(json).not.toContain(parentB.userId);
    expect(json).not.toContain(stranger.email);
    expect(json).not.toContain(strangerKid.id);
    expect(json).not.toContain(strangerKid.firstName);
    expect(json).not.toContain('LEDGERMARKER');
    expect(json).not.toContain('123457');
    expect(json).not.toContain('AUDITMARKER');
    expect(json).not.toContain('something.private');
  });

  it('omits restricted and expired guardian relationships', async () => {
    const out = await service.exportMyData(parentA, NOW);
    const json = JSON.stringify(out);
    for (const kid of [restrictedKid, expiredKid]) {
      expect(json).not.toContain(kid.id);
      expect(json).not.toContain(kid.firstName);
      expect(json).not.toContain(`Meal note for ${kid.id}`);
    }
  });

  it('shows a co-guardian only their own view of the shared child', async () => {
    const out = await service.exportMyData(parentB, NOW);
    const json = JSON.stringify(out);
    expect(out.profile.email).toBe(parentB.email);
    expect(out.children.map((c: any) => c.id)).toEqual([shared.id]);
    expect(out.children[0].relationship).toMatchObject({ canViewBilling: false });
    expect(json).not.toContain(parentA.email);
    expect(json).not.toContain('Aardvark');
    expect(json).not.toContain('MFASECRET');
  });

  it('gives staff only their own profile with no children', async () => {
    for (const staff of [educator, admin]) {
      const out = await service.exportMyData(staff, NOW);
      expect(out.profile).toMatchObject({ id: staff.userId, email: staff.email, role: staff.role });
      expect(out.children).toEqual([]);
      expect(JSON.stringify(out)).not.toContain(shared.firstName);
    }
  });

  it('audits each export once with the child count only', async () => {
    const before = (await auditFor(parentA.userId, 'privacy.export')).length;
    await service.exportMyData(parentA, NOW);
    const entries = await auditFor(parentA.userId, 'privacy.export');
    expect(entries.length).toBe(before + 1);
    const latest = entries[entries.length - 1];
    expect(latest.entityType).toBe('User');
    expect(latest.actorUserId).toBe(parentA.userId);
    expect(latest.metadata).toEqual({ children: 1 });

    const staffBefore = (await auditFor(educator.userId, 'privacy.export')).length;
    await service.exportMyData(educator, NOW);
    const staffEntries = await auditFor(educator.userId, 'privacy.export');
    expect(staffEntries).toHaveLength(staffBefore + 1);
    expect(staffEntries.every((e) => JSON.stringify(e.metadata) === JSON.stringify({ children: 0 }))).toBe(true);
  });

  it('defaults the clock to now when none is passed', async () => {
    const out = await service.exportMyData(parentA);
    expect(Math.abs(new Date(out.generatedAt).getTime() - Date.now())).toBeLessThan(60_000);
  });
});
