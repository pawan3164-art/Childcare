import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DEFAULT_BRAND } from '../../src/branding/brand-defaults';
import { BrandingService } from '../../src/branding/branding.service';
import { disconnectAll, fixturePrisma } from '../test-utils';
import { auditFor, brandRow, buildBranding, db, makeUser, nonAdmins, twoOrgs, TwoOrgs, uniqueHost } from './helpers';

describe('C0 branding: brand (white label level 1)', () => {
  let svc: BrandingService;
  let prismaService: { onModuleDestroy?: () => Promise<void> };
  let o: TwoOrgs;

  beforeAll(async () => {
    const b = await buildBranding();
    svc = b.service;
    prismaService = b.prismaService as any;
    o = await twoOrgs();
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy?.();
    await disconnectAll();
  });

  const input = { displayName: 'Sunny Days', primaryColor: '#1B3A5C', welcomeMessage: 'Welcome families', philosophy: 'Play is learning' };

  it('exposes the default brand constant', () => {
    expect(DEFAULT_BRAND).toEqual({ displayName: 'Next-Gen Childcare', primaryColor: '#0f766e' });
  });

  describe('getBrand', () => {
    it('returns defaults when the org has no brand row', async () => {
      const t = await twoOrgs();
      const view = await svc.getBrand(t.adminA);
      expect(view).toEqual({
        displayName: DEFAULT_BRAND.displayName,
        primaryColor: DEFAULT_BRAND.primaryColor,
        welcomeMessage: null,
        philosophy: null,
        logoUrl: null,
        isCustom: false,
      });
    });

    it('every authenticated role can read their own org brand', async () => {
      const t = await twoOrgs();
      await svc.updateBrand(t.adminA, input);
      for (const u of await nonAdmins(t.a)) {
        const v = await svc.getBrand(u);
        expect(v.displayName).toBe('Sunny Days');
        expect(v.isCustom).toBe(true);
        expect(v.philosophy).toBe('Play is learning');
      }
    });

    it('builds logoUrl from org id and logo version', async () => {
      const t = await twoOrgs();
      await svc.updateBrand(t.adminA, input);
      await db.organisationBrand.update({
        where: { orgId: t.a.orgId },
        data: { logoData: Buffer.from('x'), logoContentType: 'image/png', logoVersion: 3 },
      });
      const v = await svc.getBrand(t.adminA);
      expect(v.logoUrl).toBe(`/branding/logo/${t.a.orgId}?v=3`);
    });

    it("never returns another org's brand", async () => {
      const t = await twoOrgs();
      await svc.updateBrand(t.adminB, { ...input, displayName: 'Org B Only' });
      const v = await svc.getBrand(t.adminA);
      expect(v.displayName).toBe(DEFAULT_BRAND.displayName);
    });
  });

  describe('getPublicBrandForHost', () => {
    async function activeHost(t: TwoOrgs, name: string) {
      const host = uniqueHost('pub');
      await svc.updateBrand(t.adminA, { ...input, displayName: name });
      await db.organisationDomain.create({
        data: { orgId: t.a.orgId, hostname: host, status: 'ACTIVE', verificationToken: 'a'.repeat(32), verifiedAt: new Date() },
      });
      return host;
    }

    it('returns the brand for an ACTIVE domain without a philosophy key', async () => {
      const t = await twoOrgs();
      const host = await activeHost(t, 'Public Name');
      const v = await svc.getPublicBrandForHost(host);
      expect(v.displayName).toBe('Public Name');
      expect(v.primaryColor).toBe('#1b3a5c');
      expect(v.welcomeMessage).toBe('Welcome families');
      expect(v.isCustom).toBe(true);
      expect(Object.keys(v)).not.toContain('philosophy');
      expect(JSON.stringify(v)).not.toContain('Play is learning');
    });

    it('matches case-insensitively, ignoring port and trailing dot', async () => {
      const t = await twoOrgs();
      const host = await activeHost(t, 'Case Name');
      for (const variant of [host.toUpperCase(), `${host}:8443`, `${host}.`, `${host.toUpperCase()}.:443`]) {
        expect((await svc.getPublicBrandForHost(variant)).displayName).toBe('Case Name');
      }
    });

    it('serves the default brand for PENDING, unknown, empty and malformed hosts without throwing', async () => {
      const t = await twoOrgs();
      await svc.updateBrand(t.adminA, input);
      const pending = uniqueHost('pend');
      await db.organisationDomain.create({
        data: { orgId: t.a.orgId, hostname: pending, status: 'PENDING', verificationToken: 'b'.repeat(32) },
      });
      for (const h of [pending, uniqueHost('nobody'), '', '   ', '://', 'a b', '\u0000', 'x'.repeat(500), ':::80']) {
        const v = await svc.getPublicBrandForHost(h);
        expect(v).toEqual({
          displayName: DEFAULT_BRAND.displayName,
          primaryColor: DEFAULT_BRAND.primaryColor,
          welcomeMessage: null,
          logoUrl: null,
          isCustom: false,
        });
      }
    });

    it('returns the same shape for known-pending and unknown hosts (does not reveal registration)', async () => {
      const t = await twoOrgs();
      const pending = uniqueHost('pend2');
      await db.organisationDomain.create({
        data: { orgId: t.a.orgId, hostname: pending, status: 'PENDING', verificationToken: 'c'.repeat(32) },
      });
      expect(await svc.getPublicBrandForHost(pending)).toEqual(await svc.getPublicBrandForHost(uniqueHost('unk')));
    });
  });

  describe('updateBrand authorisation', () => {
    it('CENTRE_ADMIN, EDUCATOR and PARENT are Forbidden', async () => {
      const t = await twoOrgs();
      for (const u of await nonAdmins(t.a)) {
        await expect(svc.updateBrand(u, input)).rejects.toBeInstanceOf(ForbiddenException);
      }
      expect(await brandRow(t.a.orgId)).toBeNull();
    });

    it('ORG_ADMIN and PLATFORM_ADMIN of the org may update', async () => {
      const t = await twoOrgs();
      const pa = await makeUser(t.a, 'PLATFORM_ADMIN' as any);
      await expect(svc.updateBrand(t.adminA, input)).resolves.toBeDefined();
      await expect(svc.updateBrand(pa, { ...input, displayName: 'By Platform' })).resolves.toMatchObject({ displayName: 'By Platform' });
    });

    it('an org admin writes only to their own org and never touches another org', async () => {
      const t = await twoOrgs();
      await svc.updateBrand(t.adminB, { ...input, displayName: 'Org B Brand', primaryColor: '#0f766e' });
      const before = await brandRow(t.b.orgId);
      await svc.updateBrand(t.adminA, { ...input, displayName: 'Org A Brand' });
      const after = await brandRow(t.b.orgId);
      expect(after).toEqual(before);
      expect((await brandRow(t.a.orgId)).displayName).toBe('Org A Brand');
    });

    it('a user with a null orgId cannot write', async () => {
      const t = await twoOrgs();
      await expect(svc.updateBrand({ ...t.adminA, orgId: null }, input)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('updateBrand behaviour', () => {
    it('upserts, lowercases colour, sets updatedByUserId and returns the BrandView', async () => {
      const t = await twoOrgs();
      const v = await svc.updateBrand(t.adminA, input);
      expect(v).toEqual({
        displayName: 'Sunny Days',
        primaryColor: '#1b3a5c',
        welcomeMessage: 'Welcome families',
        philosophy: 'Play is learning',
        logoUrl: null,
        isCustom: true,
      });
      const row = await brandRow(t.a.orgId);
      expect(row.primaryColor).toBe('#1b3a5c');
      expect(row.updatedByUserId).toBe(t.adminA.userId);
      const second = await makeUser(t.a, 'ORG_ADMIN');
      await svc.updateBrand(second, { ...input, displayName: 'Sunny Days 2' });
      expect((await brandRow(t.a.orgId)).updatedByUserId).toBe(second.userId);
    });

    it('turns empty or whitespace-only optional text into null', async () => {
      const t = await twoOrgs();
      await svc.updateBrand(t.adminA, input);
      const v = await svc.updateBrand(t.adminA, { displayName: 'Sunny Days', primaryColor: '#1b3a5c', welcomeMessage: '   ', philosophy: '' });
      expect(v.welcomeMessage).toBeNull();
      expect(v.philosophy).toBeNull();
      const row = await brandRow(t.a.orgId);
      expect(row.welcomeMessage).toBeNull();
      expect(row.philosophy).toBeNull();
    });

    it('trims and strips control and bidi override characters from displayName', async () => {
      const t = await twoOrgs();
      const dirty = '  ‮Moon\u0000 Kids‏⁦\u007F\u0007 ';
      const v = await svc.updateBrand(t.adminA, { displayName: dirty, primaryColor: '#0f766e' });
      expect(v.displayName).toBe('Moon Kids');
    });

    it('rejects displayName outside 2 to 60 characters after cleaning', async () => {
      const t = await twoOrgs();
      const bad = ['', ' ', 'a', ' a ', '‮‮a‬', 'x'.repeat(61)];
      for (const displayName of bad) {
        await expect(svc.updateBrand(t.adminA, { displayName, primaryColor: '#0f766e' })).rejects.toBeInstanceOf(BadRequestException);
      }
      await expect(svc.updateBrand(t.adminA, { displayName: 'ab', primaryColor: '#0f766e' })).resolves.toBeDefined();
      await expect(svc.updateBrand(t.adminA, { displayName: 'x'.repeat(60), primaryColor: '#0f766e' })).resolves.toBeDefined();
    });

    it('rejects malformed colours', async () => {
      const t = await twoOrgs();
      for (const primaryColor of ['', '0f766e', '#0f766', '#0f766e0', 'red', '#gggggg', 'rgb(0,0,0)', '#0f766e;']) {
        await expect(svc.updateBrand(t.adminA, { displayName: 'Valid', primaryColor })).rejects.toBeInstanceOf(BadRequestException);
      }
    });

    it('rejects colours below 4.5:1 contrast with white and mentions contrast', async () => {
      const t = await twoOrgs();
      for (const primaryColor of ['#ffff00', '#f5f5f5', '#7dd3fc']) {
        const err: any = await svc.updateBrand(t.adminA, { displayName: 'Valid', primaryColor }).catch((e) => e);
        expect(err).toBeInstanceOf(BadRequestException);
        expect(String(err.message).toLowerCase()).toContain('contrast');
      }
    });

    it('accepts colours with sufficient contrast', async () => {
      const t = await twoOrgs();
      for (const primaryColor of ['#0f766e', '#1b3a5c', '#000000', '#1B3A5C']) {
        await expect(svc.updateBrand(t.adminA, { displayName: 'Valid', primaryColor })).resolves.toBeDefined();
      }
    });

    it('enforces welcomeMessage 300 and philosophy 2000 character limits', async () => {
      const t = await twoOrgs();
      const base = { displayName: 'Valid', primaryColor: '#0f766e' };
      await expect(svc.updateBrand(t.adminA, { ...base, welcomeMessage: 'w'.repeat(301) })).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.updateBrand(t.adminA, { ...base, philosophy: 'p'.repeat(2001) })).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        svc.updateBrand(t.adminA, { ...base, welcomeMessage: 'w'.repeat(300), philosophy: 'p'.repeat(2000) }),
      ).resolves.toBeDefined();
    });

    it('a rejected update leaves the stored brand unchanged', async () => {
      const t = await twoOrgs();
      await svc.updateBrand(t.adminA, input);
      const before = await brandRow(t.a.orgId);
      await expect(svc.updateBrand(t.adminA, { displayName: 'Bad', primaryColor: '#ffff00' })).rejects.toBeInstanceOf(BadRequestException);
      expect(await brandRow(t.a.orgId)).toEqual(before);
    });
  });

  describe('updateBrand audit', () => {
    it('lists all provided field names on first save, with no values', async () => {
      const t = await twoOrgs();
      await svc.updateBrand(t.adminA, { displayName: 'Secret Name Co', primaryColor: '#1b3a5c', welcomeMessage: 'Secret welcome', philosophy: 'Secret philosophy' });
      const entries = await auditFor(t.a.orgId, 'branding.updated', t.a.orgId);
      expect(entries).toHaveLength(1);
      const e = entries[0];
      expect(e.entityType).toBe('Organisation');
      expect(e.actorUserId).toBe(t.adminA.userId);
      expect((e.metadata as any).fields.sort()).toEqual(['displayName', 'philosophy', 'primaryColor', 'welcomeMessage']);
      const json = JSON.stringify(e.metadata);
      for (const secret of ['Secret Name Co', 'Secret welcome', 'Secret philosophy', '1b3a5c']) {
        expect(json).not.toContain(secret);
      }
    });

    it('only first-save fields actually provided are listed', async () => {
      const t = await twoOrgs();
      await svc.updateBrand(t.adminA, { displayName: 'Only Two', primaryColor: '#1b3a5c' });
      const [e] = await auditFor(t.a.orgId, 'branding.updated', t.a.orgId);
      expect((e.metadata as any).fields.sort()).toEqual(['displayName', 'primaryColor']);
    });

    it('lists only the names of fields that changed on later saves', async () => {
      const t = await twoOrgs();
      await svc.updateBrand(t.adminA, input);
      await svc.updateBrand(t.adminA, { ...input, primaryColor: '#0f766e', philosophy: 'New secret philosophy' });
      const entries = await auditFor(t.a.orgId, 'branding.updated', t.a.orgId);
      expect(entries).toHaveLength(2);
      const latest = entries.sort((x, y) => +y.timestamp - +x.timestamp)[0];
      expect((latest.metadata as any).fields.sort()).toEqual(['philosophy', 'primaryColor']);
      expect(JSON.stringify(latest.metadata)).not.toContain('New secret philosophy');
    });

    it('writes no audit entry when saving identical values (case-insensitive colour)', async () => {
      const t = await twoOrgs();
      await svc.updateBrand(t.adminA, input);
      await svc.updateBrand(t.adminA, { ...input, primaryColor: '#1b3a5c' });
      await svc.updateBrand(t.adminA, input);
      expect(await auditFor(t.a.orgId, 'branding.updated')).toHaveLength(1);
    });

    it('does not audit forbidden or invalid attempts as updates', async () => {
      const t = await twoOrgs();
      const [centreAdmin] = await nonAdmins(t.a);
      await svc.updateBrand(centreAdmin, input).catch(() => undefined);
      await svc.updateBrand(t.adminA, { displayName: 'x', primaryColor: '#0f766e' }).catch(() => undefined);
      expect(await auditFor(t.a.orgId, 'branding.updated')).toHaveLength(0);
    });

    it("writing org A's brand never creates audit entries under org B", async () => {
      const t = await twoOrgs();
      await svc.updateBrand(t.adminA, input);
      expect(await auditFor(t.b.orgId, 'branding.updated')).toHaveLength(0);
      expect(await fixturePrisma.auditLogEntry.count({ where: { orgId: t.b.orgId, action: 'branding.updated' } })).toBe(0);
    });
  });
});
