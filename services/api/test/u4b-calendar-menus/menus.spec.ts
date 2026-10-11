import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { disconnectAll } from '../test-utils';
import { NOW, auditFor, buildMenus, expectNoInternals, fixturePrisma, makeUser, seedMenu, setupFamily } from './helpers';

// NOW = Wed 2026-10-14 07:00 Sydney. Current week = Mon 2026-10-12 .. Sun 2026-10-18.
describe('U4b menus', () => {
  let h: Awaited<ReturnType<typeof buildMenus>>;
  let svc: any;
  beforeAll(async () => {
    h = await buildMenus();
    svc = h.service;
  });
  afterAll(async () => {
    await disconnectAll();
  });
  afterEach(() => jest.restoreAllMocks());

  describe('list', () => {
    it('defaults to the current Monday to Sunday week in centre time, ordered by date then meal', async () => {
      const f = await setupFamily('mn-week');
      const sun = await seedMenu(f.tenant, f.admin.userId, '2026-10-18', 'LUNCH', 'Sunday roast');
      const monPm = await seedMenu(f.tenant, f.admin.userId, '2026-10-12', 'AFTERNOON_TEA', 'Fruit');
      const monAm = await seedMenu(f.tenant, f.admin.userId, '2026-10-12', 'MORNING_TEA', 'Toast');
      const monSnack = await seedMenu(f.tenant, f.admin.userId, '2026-10-12', 'LATE_SNACK', 'Crackers');
      const monLunch = await seedMenu(f.tenant, f.admin.userId, '2026-10-12', 'LUNCH', 'Pasta', 'Contains gluten');
      const prevSun = await seedMenu(f.tenant, f.admin.userId, '2026-10-11', 'LUNCH', 'Last week');
      const nextMon = await seedMenu(f.tenant, f.admin.userId, '2026-10-19', 'LUNCH', 'Next week');
      const out = await svc.list(f.admin, {}, NOW);
      expect(out.map((m: any) => `${m.date}/${m.meal}`)).toEqual([
        '2026-10-12/MORNING_TEA',
        '2026-10-12/LUNCH',
        '2026-10-12/AFTERNOON_TEA',
        '2026-10-12/LATE_SNACK',
        '2026-10-18/LUNCH',
      ]);
      expect(out[1]).toMatchObject({ date: '2026-10-12', meal: 'LUNCH', description: 'Pasta', allergenNotes: 'Contains gluten' });
      expect(out[0].allergenNotes).toBeNull();
      const ids = out.map((m: any) => m.id).filter(Boolean);
      for (const gone of [prevSun, nextMon]) expect(ids).not.toContain(gone.id);
      expect(sun && monPm && monAm && monSnack && monLunch).toBeTruthy();
      expectNoInternals(out);
    });

    it('honours from/to (inclusive) and rejects invalid, reversed or over-31-day ranges', async () => {
      const f = await setupFamily('mn-range');
      await seedMenu(f.tenant, f.admin.userId, '2026-11-02', 'LUNCH');
      await seedMenu(f.tenant, f.admin.userId, '2026-11-09', 'LUNCH');
      await seedMenu(f.tenant, f.admin.userId, '2026-11-20', 'LUNCH');
      const out = await svc.list(f.admin, { from: '2026-11-02', to: '2026-11-09' }, NOW);
      expect(out.map((m: any) => m.date)).toEqual(['2026-11-02', '2026-11-09']);
      await expect(svc.list(f.admin, { from: 'bad' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.list(f.admin, { from: '2026-11-09', to: '2026-11-02' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.list(f.admin, { from: '2026-10-01', to: '2026-12-31' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('every role of the centre can read: admin, org admin, educator and parent with a linked child', async () => {
      const f = await setupFamily('mn-read');
      await seedMenu(f.tenant, f.admin.userId, '2026-10-14', 'LUNCH', 'Stew');
      const orgAdmin = await makeUser(f.tenant, 'ORG_ADMIN');
      for (const u of [f.admin, orgAdmin, f.educator, f.parent]) {
        const out = await svc.list(u, {}, NOW);
        expect(out).toHaveLength(1);
        expect(out[0].description).toBe('Stew');
        expectNoInternals(out);
      }
    });

    it('a parent with no linked child at the centre is Forbidden', async () => {
      const f = await setupFamily('mn-nolink');
      const stranger = await makeUser(f.tenant, 'PARENT');
      await expect(svc.list(stranger, {}, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('never shows another centre or org menu', async () => {
      const a = await setupFamily('mn-iso-a');
      const b = await setupFamily('mn-iso-b');
      const sibling = await fixturePrisma.centre.create({ data: { orgId: a.tenant.orgId, name: 'Sib' } });
      await seedMenu(a.tenant, a.admin.userId, '2026-10-14', 'LUNCH', 'Mine');
      await seedMenu(b.tenant, b.admin.userId, '2026-10-14', 'LUNCH', 'Theirs');
      await seedMenu({ orgId: a.tenant.orgId, centreId: sibling.id }, a.admin.userId, '2026-10-14', 'LUNCH', 'Sibling');
      for (const u of [a.admin, a.educator, a.parent]) {
        expect((await svc.list(u, {}, NOW)).map((m: any) => m.description)).toEqual(['Mine']);
      }
    });
  });

  describe('set', () => {
    it('creates an item with trimmed text and the documented shape', async () => {
      const f = await setupFamily('ms-create');
      const m = await svc.set(f.admin, '2026-10-15', 'LUNCH', { description: '  Chicken rice  ', allergenNotes: ' Contains egg ' }, NOW);
      expect(m).toMatchObject({ date: '2026-10-15', meal: 'LUNCH', description: 'Chicken rice', allergenNotes: 'Contains egg' });
      expect(m.updatedAt).toBeInstanceOf(Date);
      expectNoInternals(m);
      const row = await fixturePrisma.menuItem.findFirstOrThrow({ where: { centreId: f.tenant.centreId } });
      expect(row.updatedByUserId).toBe(f.admin.userId);
      expect(row.orgId).toBe(f.tenant.orgId);
    });

    it('upserts on (centre, date, meal): the second set replaces the first, including clearing allergenNotes', async () => {
      const f = await setupFamily('ms-upsert');
      await svc.set(f.admin, '2026-10-15', 'LUNCH', { description: 'First', allergenNotes: 'Nuts' }, NOW);
      const second = await svc.set(f.admin, '2026-10-15', 'LUNCH', { description: 'Second' }, NOW);
      expect(second).toMatchObject({ description: 'Second', allergenNotes: null });
      expect(await fixturePrisma.menuItem.count({ where: { centreId: f.tenant.centreId } })).toBe(1);
    });

    it('different meals on the same day are separate items; concurrent sets of the same slot leave one row', async () => {
      const f = await setupFamily('ms-multi');
      await svc.set(f.admin, '2026-10-15', 'LUNCH', { description: 'A' }, NOW);
      await svc.set(f.admin, '2026-10-15', 'MORNING_TEA', { description: 'B' }, NOW);
      expect(await fixturePrisma.menuItem.count({ where: { centreId: f.tenant.centreId } })).toBe(2);
      await Promise.all([
        svc.set(f.admin, '2026-10-16', 'LUNCH', { description: 'X' }, NOW),
        svc.set(f.admin, '2026-10-16', 'LUNCH', { description: 'Y' }, NOW),
      ]);
      expect(await fixturePrisma.menuItem.count({ where: { centreId: f.tenant.centreId, date: new Date('2026-10-16T00:00:00Z') } })).toBe(1);
    });

    it('does not touch another centre with the same date and meal', async () => {
      const a = await setupFamily('ms-iso-a');
      const b = await setupFamily('ms-iso-b');
      await seedMenu(b.tenant, b.admin.userId, '2026-10-15', 'LUNCH', 'Theirs');
      await svc.set(a.admin, '2026-10-15', 'LUNCH', { description: 'Mine' }, NOW);
      expect((await fixturePrisma.menuItem.findFirstOrThrow({ where: { centreId: b.tenant.centreId } })).description).toBe('Theirs');
    });

    it.each([
      ['empty description', { description: '' }],
      ['blank description', { description: '   ' }],
      ['description over 500', { description: 'x'.repeat(501) }],
      ['allergenNotes over 500', { description: 'ok', allergenNotes: 'a'.repeat(501) }],
    ])('rejects %s', async (_n, dto) => {
      const f = await setupFamily('ms-validate');
      await expect(svc.set(f.admin, '2026-10-15', 'LUNCH', dto, NOW)).rejects.toBeInstanceOf(BadRequestException);
      expect(await fixturePrisma.menuItem.count({ where: { centreId: f.tenant.centreId } })).toBe(0);
    });

    it('accepts exactly 500 chars for both text fields', async () => {
      const f = await setupFamily('ms-max');
      await expect(svc.set(f.admin, '2026-10-15', 'LUNCH', { description: 'x'.repeat(500), allergenNotes: 'a'.repeat(500) }, NOW)).resolves.toBeDefined();
    });

    it.each(['2026-13-01', '2026-02-30', 'tomorrow', ''])('rejects the invalid date %p', async (date) => {
      const f = await setupFamily('ms-date');
      await expect(svc.set(f.admin, date, 'LUNCH', { description: 'x' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an unknown meal', async () => {
      const f = await setupFamily('ms-meal');
      await expect(svc.set(f.admin, '2026-10-15', 'BREAKFAST', { description: 'x' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    });

    it.each(['educator', 'parent'] as const)('%s is Forbidden', async (who) => {
      const f = await setupFamily(`ms-forbid-${who}`);
      await expect(svc.set((f as any)[who], '2026-10-15', 'LUNCH', { description: 'x' }, NOW)).rejects.toBeInstanceOf(ForbiddenException);
      expect(await fixturePrisma.menuItem.count({ where: { centreId: f.tenant.centreId } })).toBe(0);
    });

    it('audits menu.set with ids and meal only, never the text', async () => {
      const f = await setupFamily('ms-audit');
      await svc.set(f.admin, '2026-10-15', 'LUNCH', { description: 'SecretDishXyz', allergenNotes: 'SecretAllergenXyz' }, NOW);
      const row = await fixturePrisma.menuItem.findFirstOrThrow({ where: { centreId: f.tenant.centreId } });
      const rows = (await auditFor(row.id)).filter((r) => r.action === 'menu.set');
      expect(rows).toHaveLength(1);
      expect(rows[0].entityType).toBe('MenuItem');
      expect(rows[0].actorUserId).toBe(f.admin.userId);
      expect(JSON.stringify(rows[0].metadata)).toContain('LUNCH');
      expect(JSON.stringify(rows[0])).not.toMatch(/SecretDishXyz|SecretAllergenXyz/);
    });

    it('rolls the change back when the audit write fails (same transaction)', async () => {
      const f = await setupFamily('ms-tx');
      const existing = await seedMenu(f.tenant, f.admin.userId, '2026-10-15', 'LUNCH', 'Original');
      jest.spyOn(h.audit, 'record').mockRejectedValue(new Error('audit down'));
      await expect(svc.set(f.admin, '2026-10-15', 'LUNCH', { description: 'Changed' }, NOW)).rejects.toThrow();
      await expect(svc.set(f.admin, '2026-10-16', 'LUNCH', { description: 'New' }, NOW)).rejects.toThrow();
      expect((await fixturePrisma.menuItem.findUniqueOrThrow({ where: { id: existing.id } })).description).toBe('Original');
      expect(await fixturePrisma.menuItem.count({ where: { centreId: f.tenant.centreId } })).toBe(1);
    });
  });

  describe('clear', () => {
    it('removes the item and audits menu.cleared without text', async () => {
      const f = await setupFamily('mc-ok');
      const item = await seedMenu(f.tenant, f.admin.userId, '2026-10-15', 'LUNCH', 'SecretDishXyz', 'SecretAllergenXyz');
      await svc.clear(f.admin, '2026-10-15', 'LUNCH', NOW);
      expect(await fixturePrisma.menuItem.count({ where: { id: item.id } })).toBe(0);
      const rows = (await auditFor(item.id)).filter((r) => r.action === 'menu.cleared');
      expect(rows).toHaveLength(1);
      expect(JSON.stringify(rows[0].metadata)).toContain('LUNCH');
      expect(JSON.stringify(rows[0])).not.toMatch(/SecretDishXyz|SecretAllergenXyz/);
    });

    it('is NotFound when nothing is set, and a second clear is NotFound', async () => {
      const f = await setupFamily('mc-404');
      await expect(svc.clear(f.admin, '2026-10-15', 'LUNCH', NOW)).rejects.toBeInstanceOf(NotFoundException);
      await seedMenu(f.tenant, f.admin.userId, '2026-10-15', 'LUNCH');
      await svc.clear(f.admin, '2026-10-15', 'LUNCH', NOW);
      await expect(svc.clear(f.admin, '2026-10-15', 'LUNCH', NOW)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('only clears the named meal', async () => {
      const f = await setupFamily('mc-meal');
      await seedMenu(f.tenant, f.admin.userId, '2026-10-15', 'LUNCH');
      await seedMenu(f.tenant, f.admin.userId, '2026-10-15', 'MORNING_TEA');
      await svc.clear(f.admin, '2026-10-15', 'LUNCH', NOW);
      expect((await fixturePrisma.menuItem.findMany({ where: { centreId: f.tenant.centreId } })).map((r) => r.meal)).toEqual(['MORNING_TEA']);
    });

    it('cannot clear another centre or org menu (NotFound) and leaves it intact', async () => {
      const a = await setupFamily('mc-iso-a');
      const b = await setupFamily('mc-iso-b');
      const theirs = await seedMenu(b.tenant, b.admin.userId, '2026-10-15', 'LUNCH');
      await expect(svc.clear(a.admin, '2026-10-15', 'LUNCH', NOW)).rejects.toBeInstanceOf(NotFoundException);
      expect(await fixturePrisma.menuItem.count({ where: { id: theirs.id } })).toBe(1);
    });

    it.each(['educator', 'parent'] as const)('%s is Forbidden', async (who) => {
      const f = await setupFamily(`mc-forbid-${who}`);
      const item = await seedMenu(f.tenant, f.admin.userId, '2026-10-15', 'LUNCH');
      await expect(svc.clear((f as any)[who], '2026-10-15', 'LUNCH', NOW)).rejects.toBeInstanceOf(ForbiddenException);
      expect(await fixturePrisma.menuItem.count({ where: { id: item.id } })).toBe(1);
    });

    it('rolls the delete back when the audit write fails (same transaction)', async () => {
      const f = await setupFamily('mc-tx');
      const item = await seedMenu(f.tenant, f.admin.userId, '2026-10-15', 'LUNCH');
      jest.spyOn(h.audit, 'record').mockRejectedValue(new Error('audit down'));
      await expect(svc.clear(f.admin, '2026-10-15', 'LUNCH', NOW)).rejects.toThrow();
      expect(await fixturePrisma.menuItem.count({ where: { id: item.id } })).toBe(1);
    });
  });
});
