import { ForbiddenException } from '@nestjs/common';
import { appPrisma, disconnectAll, seedOrgCentreRoom } from '../test-utils';
import { NOW, buildHealth, expectNoInternals, fixturePrisma, makeChild, makeUser, seedAllergy, seedImmunisation, setupFamily } from './helpers';

describe('U4a allergy register', () => {
  let h: Awaited<ReturnType<typeof buildHealth>>;
  let svc: any;
  beforeAll(async () => {
    h = await buildHealth();
    svc = h.service;
  });
  afterAll(async () => {
    await disconnectAll();
  });

  async function centreWithKids() {
    const tenant = await seedOrgCentreRoom('reg');
    const admin = await makeUser(tenant, 'CENTRE_ADMIN');
    const educator = await makeUser(tenant, 'EDUCATOR', tenant.roomId);
    const room2 = await fixturePrisma.room.create({ data: { orgId: tenant.orgId, centreId: tenant.centreId, name: 'Second room' } });
    const mk = async (lastName: string, roomId: string) =>
      fixturePrisma.child.create({
        data: { orgId: tenant.orgId, centreId: tenant.centreId, roomId, firstName: 'K', lastName, dateOfBirth: new Date('2023-01-01') },
      });
    return { tenant, admin, educator, room2, mk };
  }

  it('lists children with active allergies, highest severity first then last name, omitting the rest', async () => {
    const c = await centreWithKids();
    const zed = await c.mk('Zed', c.tenant.roomId);
    const abe = await c.mk('Abe', c.tenant.roomId);
    const bob = await c.mk('Bob', c.room2.id);
    const none = await c.mk('None', c.tenant.roomId);
    const endedOnly = await c.mk('Ended', c.tenant.roomId);
    const departed = await c.mk('Departed', c.tenant.roomId);
    await fixturePrisma.child.update({ where: { id: departed.id }, data: { departedOn: new Date('2026-09-30') } });
    await seedAllergy(c.tenant, zed.id, c.admin.userId, 'Peanuts', 'ANAPHYLAXIS');
    await seedAllergy(c.tenant, abe.id, c.admin.userId, 'Egg', 'MODERATE');
    await seedAllergy(c.tenant, abe.id, c.admin.userId, 'Soy', 'SEVERE');
    await seedAllergy(c.tenant, bob.id, c.admin.userId, 'Dust', 'MILD');
    await seedAllergy(c.tenant, endedOnly.id, c.admin.userId, 'Old', 'SEVERE', { ended: true });
    await seedAllergy(c.tenant, departed.id, c.admin.userId, 'Bee', 'SEVERE');

    const reg = await svc.allergyRegister(c.admin, NOW);
    expect(reg.map((r: any) => r.childId)).toEqual([zed.id, abe.id, bob.id]);
    expect(reg.map((r: any) => r.childId)).not.toContain(none.id);
    expect(reg.map((r: any) => r.childId)).not.toContain(endedOnly.id);
    expect(reg.map((r: any) => r.childId)).not.toContain(departed.id);
    expect(reg[0]).toMatchObject({ childId: zed.id, firstName: 'K', lastName: 'Zed', roomName: expect.any(String) });
    expect(reg[0].allergies).toEqual([{ allergen: 'Peanuts', severity: 'ANAPHYLAXIS' }]);
    expect(reg[1].allergies.map((a: any) => a.allergen)).toEqual(['Soy', 'Egg']);
    expect(reg[2].roomName).toBe('Second room');
    expectNoInternals(reg);
  });

  it('breaks severity ties by last name', async () => {
    const c = await centreWithKids();
    const b = await c.mk('Bravo', c.tenant.roomId);
    const a = await c.mk('Alpha', c.tenant.roomId);
    await seedAllergy(c.tenant, b.id, c.admin.userId, 'Egg', 'SEVERE');
    await seedAllergy(c.tenant, a.id, c.admin.userId, 'Soy', 'SEVERE');
    const reg = await svc.allergyRegister(c.admin, NOW);
    expect(reg.map((r: any) => r.lastName)).toEqual(['Alpha', 'Bravo']);
  });

  it('an educator sees only children in rooms they are assigned to', async () => {
    const c = await centreWithKids();
    const mine = await c.mk('Mine', c.tenant.roomId);
    const theirs = await c.mk('Theirs', c.room2.id);
    await seedAllergy(c.tenant, mine.id, c.admin.userId, 'Egg', 'MILD');
    await seedAllergy(c.tenant, theirs.id, c.admin.userId, 'Egg', 'ANAPHYLAXIS');
    const reg = await svc.allergyRegister(c.educator, NOW);
    expect(reg.map((r: any) => r.childId)).toEqual([mine.id]);
  });

  it('an educator whose room assignment has ended sees nothing from that room', async () => {
    const c = await centreWithKids();
    const kid = await c.mk('Kid', c.tenant.roomId);
    await seedAllergy(c.tenant, kid.id, c.admin.userId, 'Egg', 'MILD');
    await fixturePrisma.staffRoomAssignment.updateMany({ where: { userId: c.educator.userId }, data: { endDate: new Date('2026-06-30') } });
    expect(await svc.allergyRegister(c.educator, NOW)).toEqual([]);
  });

  it('a parent is Forbidden', async () => {
    const f = await setupFamily('reg-parent');
    await expect(svc.allergyRegister(f.parent, NOW)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('never leaks another centre or org', async () => {
    const a = await setupFamily('reg-iso-a');
    const b = await setupFamily('reg-iso-b');
    await seedAllergy(a.tenant, a.child.id, a.admin.userId, 'Peanuts', 'SEVERE');
    await seedAllergy(b.tenant, b.child.id, b.admin.userId, 'Egg', 'SEVERE');
    const regA = await svc.allergyRegister(a.admin, NOW);
    const regB = await svc.allergyRegister(b.admin, NOW);
    expect(regA.map((r: any) => r.childId)).toEqual([a.child.id]);
    expect(regB.map((r: any) => r.childId)).toEqual([b.child.id]);
  });

  it.each(['ORG_ADMIN', 'PLATFORM_ADMIN'] as const)('%s with a centreId may read the register', async (role) => {
    const f = await setupFamily(`reg-${role}`);
    await seedAllergy(f.tenant, f.child.id, f.admin.userId, 'Egg', 'MILD');
    const u = await makeUser(f.tenant, role);
    expect((await svc.allergyRegister(u, NOW)).map((r: any) => r.childId)).toEqual([f.child.id]);
  });
});

describe('U4a tenant isolation and append-only database role', () => {
  afterAll(disconnectAll);

  async function asTenant<T>(orgId: string, centreId: string, fn: (tx: any) => Promise<T>): Promise<T> {
    return appPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_org_id', ${orgId}, true)`;
      await tx.$executeRaw`SELECT set_config('app.current_centre_id', ${centreId}, true)`;
      return fn(tx);
    });
  }

  it('rows are invisible through another org context (all three tables)', async () => {
    const a = await setupFamily('rls-a');
    const b = await setupFamily('rls-b');
    await seedAllergy(a.tenant, a.child.id, a.admin.userId, 'Peanuts', 'SEVERE');
    await seedImmunisation(a.tenant, a.child.id, a.admin.userId, 'MMR', '2025-02-01');
    await fixturePrisma.childImmunisationStatus.create({
      data: { orgId: a.tenant.orgId, centreId: a.tenant.centreId, childId: a.child.id, status: 'UP_TO_DATE', updatedByUserId: a.admin.userId },
    });
    const own = await asTenant(a.tenant.orgId, a.tenant.centreId, async (tx) => ({
      al: await tx.childAllergy.count({ where: { childId: a.child.id } }),
      im: await tx.childImmunisation.count({ where: { childId: a.child.id } }),
      st: await tx.childImmunisationStatus.count({ where: { childId: a.child.id } }),
    }));
    expect(own).toEqual({ al: 1, im: 1, st: 1 });
    const other = await asTenant(b.tenant.orgId, b.tenant.centreId, async (tx) => ({
      al: await tx.childAllergy.count({ where: { childId: a.child.id } }),
      im: await tx.childImmunisation.count({ where: { childId: a.child.id } }),
      st: await tx.childImmunisationStatus.count({ where: { childId: a.child.id } }),
    }));
    expect(other).toEqual({ al: 0, im: 0, st: 0 });
  });

  it('another org cannot insert rows for this org', async () => {
    const a = await setupFamily('rls-ins-a');
    const b = await setupFamily('rls-ins-b');
    await expect(
      asTenant(b.tenant.orgId, b.tenant.centreId, (tx) =>
        tx.childAllergy.create({
          data: { orgId: a.tenant.orgId, centreId: a.tenant.centreId, childId: a.child.id, allergen: 'X', severity: 'MILD', recordedByUserId: b.admin.userId },
        }),
      ),
    ).rejects.toThrow();
  });

  it('the app role cannot DELETE allergies or immunisations', async () => {
    const f = await setupFamily('rls-del');
    const al = await seedAllergy(f.tenant, f.child.id, f.admin.userId, 'Peanuts', 'SEVERE');
    const im = await seedImmunisation(f.tenant, f.child.id, f.admin.userId, 'MMR', '2025-02-01');
    await expect(asTenant(f.tenant.orgId, f.tenant.centreId, (tx) => tx.$executeRaw`DELETE FROM child_allergies WHERE id = ${al.id}`)).rejects.toThrow(/permission denied/i);
    await expect(asTenant(f.tenant.orgId, f.tenant.centreId, (tx) => tx.$executeRaw`DELETE FROM child_immunisations WHERE id = ${im.id}`)).rejects.toThrow(/permission denied/i);
    expect(await fixturePrisma.childAllergy.count({ where: { id: al.id } })).toBe(1);
    expect(await fixturePrisma.childImmunisation.count({ where: { id: im.id } })).toBe(1);
  });

  it('the app role cannot UPDATE allergen, severity or vaccine', async () => {
    const f = await setupFamily('rls-upd');
    const al = await seedAllergy(f.tenant, f.child.id, f.admin.userId, 'Peanuts', 'SEVERE');
    const im = await seedImmunisation(f.tenant, f.child.id, f.admin.userId, 'MMR', '2025-02-01');
    await expect(asTenant(f.tenant.orgId, f.tenant.centreId, (tx) => tx.$executeRaw`UPDATE child_allergies SET allergen = 'Changed' WHERE id = ${al.id}`)).rejects.toThrow(/permission denied/i);
    await expect(asTenant(f.tenant.orgId, f.tenant.centreId, (tx) => tx.$executeRawUnsafe(`UPDATE child_allergies SET severity = 'MILD' WHERE id = '${al.id}'`))).rejects.toThrow(/permission denied/i);
    await expect(asTenant(f.tenant.orgId, f.tenant.centreId, (tx) => tx.$executeRaw`UPDATE child_immunisations SET vaccine = 'Changed' WHERE id = ${im.id}`)).rejects.toThrow(/permission denied/i);
    const row = await fixturePrisma.childAllergy.findUniqueOrThrow({ where: { id: al.id } });
    expect(row.allergen).toBe('Peanuts');
    expect(row.severity).toBe('SEVERE');
  });

  it('the app role can still end an allergy and void an immunisation (end/void columns only)', async () => {
    const f = await setupFamily('rls-end');
    const al = await seedAllergy(f.tenant, f.child.id, f.admin.userId, 'Peanuts', 'SEVERE');
    const im = await seedImmunisation(f.tenant, f.child.id, f.admin.userId, 'MMR', '2025-02-01');
    await asTenant(f.tenant.orgId, f.tenant.centreId, async (tx) => {
      await tx.$executeRaw`UPDATE child_allergies SET ended_at = now(), ended_by_user_id = ${f.admin.userId}, end_reason = 'x y z' WHERE id = ${al.id}`;
      await tx.$executeRaw`UPDATE child_immunisations SET voided_at = now(), voided_by_user_id = ${f.admin.userId}, void_reason = 'x y z' WHERE id = ${im.id}`;
    });
    expect((await fixturePrisma.childAllergy.findUniqueOrThrow({ where: { id: al.id } })).endedAt).not.toBeNull();
    expect((await fixturePrisma.childImmunisation.findUniqueOrThrow({ where: { id: im.id } })).voidedAt).not.toBeNull();
  });

  it('unused helper sanity: makeChild is usable', async () => {
    const f = await setupFamily('rls-sanity');
    expect((await makeChild(f.tenant)).id).toBeTruthy();
  });
});
