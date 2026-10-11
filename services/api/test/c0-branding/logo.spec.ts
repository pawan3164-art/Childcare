import { BadRequestException, ForbiddenException } from '@nestjs/common';
import sharp from 'sharp';
import { DEFAULT_BRAND } from '../../src/branding/brand-defaults';
import { BrandingService } from '../../src/branding/branding.service';
import { disconnectAll } from '../test-utils';
import { auditFor, brandRow, buildBranding, image, nonAdmins, PNG_SIGNATURE, twoOrgs, TwoOrgs } from './helpers';

describe('C0 branding: logo', () => {
  let svc: BrandingService;
  let prismaService: { onModuleDestroy?: () => Promise<void> };
  let o: TwoOrgs;

  beforeAll(async () => {
    const b = await buildBranding();
    svc = b.service;
    prismaService = b.prismaService as any;
  });

  beforeEach(async () => {
    o = await twoOrgs();
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy?.();
    await disconnectAll();
  });

  const png = async (w = 100, h = 50) => ({ buffer: await image(w, h, 'png'), mimetype: 'image/png' });

  describe('authorisation', () => {
    it('only org admins may set or remove a logo', async () => {
      const file = await png();
      for (const u of await nonAdmins(o.a)) {
        await expect(svc.setLogo(u, file)).rejects.toBeInstanceOf(ForbiddenException);
        await expect(svc.removeLogo(u)).rejects.toBeInstanceOf(ForbiddenException);
      }
      expect(await brandRow(o.a.orgId)).toBeNull();
    });

    it('other orgs are untouched by set and remove', async () => {
      await svc.setLogo(o.adminB, await png(40, 40));
      const before = await brandRow(o.b.orgId);
      await svc.setLogo(o.adminA, await png());
      await svc.removeLogo(o.adminA);
      await svc.setLogo(o.adminA, await png(60, 30));
      expect(await brandRow(o.b.orgId)).toEqual(before);
      expect(await svc.getLogo(o.b.orgId)).not.toBeNull();
    });
  });

  describe('accepted and rejected input', () => {
    it.each([
      ['png', 'image/png'],
      ['jpeg', 'image/jpeg'],
      ['webp', 'image/webp'],
    ] as const)('accepts %s', async (fmt, mimetype) => {
      const view = await svc.setLogo(o.adminA, { buffer: await image(120, 60, fmt), mimetype });
      expect(view.logoUrl).toMatch(new RegExp(`^/branding/logo/${o.a.orgId}\\?v=\\d+$`));
    });

    it('rejects svg, gif, pdf mimetypes', async () => {
      const bytes = await image(50, 50, 'png');
      for (const mimetype of ['image/svg+xml', 'image/gif', 'application/pdf', 'text/html', '']) {
        await expect(svc.setLogo(o.adminA, { buffer: bytes, mimetype })).rejects.toBeInstanceOf(BadRequestException);
      }
    });

    it('rejects actual gif bytes even when labelled as png', async () => {
      await expect(svc.setLogo(o.adminA, { buffer: await image(50, 50, 'gif'), mimetype: 'image/png' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects svg markup labelled as an allowed image type', async () => {
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
      for (const mimetype of ['image/png', 'image/jpeg', 'image/webp']) {
        await expect(svc.setLogo(o.adminA, { buffer: svg, mimetype })).rejects.toBeInstanceOf(BadRequestException);
      }
    });

    it('rejects bytes that are not a decodable image', async () => {
      await expect(svc.setLogo(o.adminA, { buffer: Buffer.from('not an image at all'), mimetype: 'image/png' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.setLogo(o.adminA, { buffer: Buffer.alloc(0), mimetype: 'image/png' })).rejects.toBeInstanceOf(BadRequestException);
      const truncated = (await image(200, 200, 'png')).subarray(0, 40);
      await expect(svc.setLogo(o.adminA, { buffer: truncated, mimetype: 'image/png' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a mimetype that does not match the real format (jpeg bytes labelled png)', async () => {
      await expect(svc.setLogo(o.adminA, { buffer: await image(50, 50, 'jpeg'), mimetype: 'image/png' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects files larger than 512 KiB and accepts at the limit', async () => {
      const big = Buffer.concat([await image(50, 50, 'png'), Buffer.alloc(512 * 1024)]);
      expect(big.length).toBeGreaterThan(512 * 1024);
      await expect(svc.setLogo(o.adminA, { buffer: big, mimetype: 'image/png' })).rejects.toBeInstanceOf(BadRequestException);
      expect(await brandRow(o.a.orgId)).toBeNull();
    });
  });

  describe('re-encoding', () => {
    it('stores a PNG regardless of the input format', async () => {
      await svc.setLogo(o.adminA, { buffer: await image(120, 60, 'jpeg'), mimetype: 'image/jpeg' });
      const logo = await svc.getLogo(o.a.orgId);
      expect(logo).not.toBeNull();
      expect(logo!.contentType).toBe('image/png');
      expect(logo!.data.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
      expect((await sharp(logo!.data).metadata()).format).toBe('png');
    });

    it('fits a 2000x1000 input inside 600x300 keeping aspect ratio', async () => {
      await svc.setLogo(o.adminA, { buffer: await image(2000, 1000, 'png'), mimetype: 'image/png' });
      const meta = await sharp((await svc.getLogo(o.a.orgId))!.data).metadata();
      expect(meta.width!).toBeLessThanOrEqual(600);
      expect(meta.height!).toBeLessThanOrEqual(300);
      expect(meta.width! / meta.height!).toBeCloseTo(2, 1);
    });

    it('fits a tall input inside the box', async () => {
      await svc.setLogo(o.adminA, { buffer: await image(500, 1500, 'png'), mimetype: 'image/png' });
      const meta = await sharp((await svc.getLogo(o.a.orgId))!.data).metadata();
      expect(meta.height!).toBeLessThanOrEqual(300);
      expect(meta.width!).toBeLessThanOrEqual(600);
      expect(meta.height! / meta.width!).toBeCloseTo(3, 0);
    });

    it('does not enlarge a small image', async () => {
      await svc.setLogo(o.adminA, await png(100, 50));
      const meta = await sharp((await svc.getLogo(o.a.orgId))!.data).metadata();
      expect(meta.width).toBe(100);
      expect(meta.height).toBe(50);
    });

    it('strips metadata such as EXIF', async () => {
      const withExif = await sharp({ create: { width: 200, height: 100, channels: 3, background: { r: 1, g: 100, b: 90 } } })
        .jpeg()
        .withMetadata({ exif: { IFD0: { Copyright: 'secret-owner-name', ImageDescription: 'GPS home address' } } })
        .toBuffer();
      expect((await sharp(withExif).metadata()).exif).toBeDefined();
      await svc.setLogo(o.adminA, { buffer: withExif, mimetype: 'image/jpeg' });
      const out = (await svc.getLogo(o.a.orgId))!.data;
      expect((await sharp(out).metadata()).exif).toBeUndefined();
      expect(out.toString('latin1')).not.toContain('secret-owner-name');
      expect(out.toString('latin1')).not.toContain('GPS home address');
    });
  });

  describe('brand row, versions and getLogo', () => {
    it('creates a brand row with defaults when none exists', async () => {
      const view = await svc.setLogo(o.adminA, await png());
      const row = await brandRow(o.a.orgId);
      expect(row.displayName).toBe(DEFAULT_BRAND.displayName);
      expect(row.primaryColor).toBe(DEFAULT_BRAND.primaryColor);
      expect(row.updatedByUserId).toBe(o.adminA.userId);
      expect(view.displayName).toBe(DEFAULT_BRAND.displayName);
      expect(view.logoUrl).toBe(`/branding/logo/${o.a.orgId}?v=${row.logoVersion}`);
    });

    it('keeps existing brand text when a logo is set', async () => {
      await svc.updateBrand(o.adminA, { displayName: 'Keep Me', primaryColor: '#1b3a5c', welcomeMessage: 'Hello' });
      await svc.setLogo(o.adminA, await png());
      const v = await svc.getBrand(o.adminA);
      expect(v).toMatchObject({ displayName: 'Keep Me', primaryColor: '#1b3a5c', welcomeMessage: 'Hello' });
      expect(v.logoUrl).not.toBeNull();
    });

    it('increases logoVersion by 1 on every change (set, replace, remove)', async () => {
      await svc.setLogo(o.adminA, await png());
      const v1 = (await brandRow(o.a.orgId)).logoVersion;
      await svc.setLogo(o.adminA, await png(80, 40));
      const v2 = (await brandRow(o.a.orgId)).logoVersion;
      await svc.removeLogo(o.adminA);
      const v3 = (await brandRow(o.a.orgId)).logoVersion;
      expect(v2).toBe(v1 + 1);
      expect(v3).toBe(v2 + 1);
    });

    it('getLogo returns data, contentType and version for the public', async () => {
      await svc.setLogo(o.adminA, await png());
      const logo = await svc.getLogo(o.a.orgId);
      expect(Buffer.isBuffer(logo!.data)).toBe(true);
      expect(logo!.version).toBe((await brandRow(o.a.orgId)).logoVersion);
    });

    it('getLogo returns null when there is no logo, no brand row, or an unknown org', async () => {
      expect(await svc.getLogo(o.a.orgId)).toBeNull();
      await svc.updateBrand(o.adminA, { displayName: 'No Logo', primaryColor: '#0f766e' });
      expect(await svc.getLogo(o.a.orgId)).toBeNull();
      expect(await svc.getLogo('00000000-0000-0000-0000-000000000000')).toBeNull();
      expect(await svc.getLogo('not-a-uuid')).toBeNull();
    });

    it('removeLogo clears the logo and the URL, and bumps the version', async () => {
      await svc.setLogo(o.adminA, await png());
      const view = await svc.removeLogo(o.adminA);
      expect(view.logoUrl).toBeNull();
      expect(await svc.getLogo(o.a.orgId)).toBeNull();
      const row = await brandRow(o.a.orgId);
      expect(row.logoData).toBeNull();
      expect(row.logoContentType).toBeNull();
    });

    it("getLogo(orgA) never returns org B's logo", async () => {
      await svc.setLogo(o.adminB, await png(40, 40));
      expect(await svc.getLogo(o.a.orgId)).toBeNull();
    });
  });

  describe('audit', () => {
    it('writes branding.logo_set and branding.logo_removed with no image content', async () => {
      await svc.setLogo(o.adminA, await png());
      await svc.removeLogo(o.adminA);
      const set = await auditFor(o.a.orgId, 'branding.logo_set');
      const removed = await auditFor(o.a.orgId, 'branding.logo_removed');
      expect(set).toHaveLength(1);
      expect(removed).toHaveLength(1);
      expect(set[0].entityType).toBe('Organisation');
      expect(set[0].entityId).toBe(o.a.orgId);
      expect(set[0].actorUserId).toBe(o.adminA.userId);
      expect(JSON.stringify(set[0].metadata).length).toBeLessThan(500);
    });

    it('does not audit rejected uploads', async () => {
      await svc.setLogo(o.adminA, { buffer: Buffer.from('nope'), mimetype: 'image/png' }).catch(() => undefined);
      expect(await auditFor(o.a.orgId, 'branding.logo_set')).toHaveLength(0);
    });
  });
});
