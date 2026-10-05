import sharp from 'sharp';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { AuthorizationService } from '../../src/authorization/authorization.service';
import { MediaService } from '../../src/media/media.service';
import { InMemoryObjectStorage } from '../../src/media/storage/in-memory-object-storage';
import { RequestUser } from '../../src/authorization/request-user.interface';
import { disconnectAll, fixturePrisma, seedOrgCentreRoom, uniqueSuffix } from '../test-utils';

/**
 * ADR 0004 / BRD §17: real photo upload. Bytes are re-encoded so EXIF and GPS
 * never reach storage, objects live under the tenant's prefix, and a view URL
 * is issued only after the same multi-child visibility check as canView().
 */
describe('MediaService.upload and view URLs (ADR 0004)', () => {
  let prismaService: PrismaService;
  let storage: InMemoryObjectStorage;
  let media: MediaService;

  beforeAll(async () => {
    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    const tenancy = new TenancyService(prismaService);
    const audit = new AuditService(tenancy);
    const authorization = new AuthorizationService(tenancy, audit);
    storage = new InMemoryObjectStorage();
    media = new MediaService(tenancy, audit, authorization, storage);
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  /** A small JPEG carrying GPS coordinates and a camera make in its EXIF. */
  async function jpegWithGps(): Promise<Buffer> {
    return sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 120, b: 40 } } })
      .jpeg()
      .withExif({
        IFD0: { Make: 'TestCam', Model: 'Leaky 1' },
        IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '33/1 52/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '151/1 12/1 0/1' },
      })
      .toBuffer();
  }

  async function setup(label: string, guardianCanViewMedia = true) {
    const tenant = await seedOrgCentreRoom(label);
    const educator = await fixturePrisma.user.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, email: `edu-${uniqueSuffix()}@example.test`, passwordHash: 'x', role: 'EDUCATOR', firstName: 'E', lastName: 'D' },
    });
    await fixturePrisma.staffRoomAssignment.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, userId: educator.id, roomId: tenant.roomId, startDate: new Date('2026-01-01') },
    });
    const child = await fixturePrisma.child.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, roomId: tenant.roomId, firstName: 'C', lastName: `Upload-${uniqueSuffix()}`, dateOfBirth: new Date('2023-01-01') },
    });
    const guardian = await fixturePrisma.user.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, email: `g-${uniqueSuffix()}@example.test`, passwordHash: 'x', role: 'PARENT', firstName: 'G', lastName: 'P' },
    });
    await fixturePrisma.guardianChildRelationship.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, guardianUserId: guardian.id, childId: child.id, relationshipType: 'PARENT', canViewMedia: guardianCanViewMedia },
    });
    const educatorUser: RequestUser = { userId: educator.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'EDUCATOR', sessionId: 's' };
    const guardianUser: RequestUser = { userId: guardian.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'PARENT', sessionId: 's' };
    return { tenant, child, educatorUser, guardianUser };
  }

  it('strips EXIF/GPS, stores under the tenant prefix, and records size and dimensions', async () => {
    const { tenant, child, educatorUser } = await setup('UploadStrip');
    const original = await jpegWithGps();
    expect((await sharp(original).metadata()).exif).toBeDefined(); // the fixture really carries EXIF

    const asset = await media.upload(educatorUser, { buffer: original, mimetype: 'image/jpeg', size: original.length }, { childIds: [child.id] });

    expect(asset.storageKey.startsWith(`org/${tenant.orgId}/centre/${tenant.centreId}/media/`)).toBe(true);
    const stored = storage.get(asset.storageKey);
    expect(stored).toBeDefined();
    const meta = await sharp(stored!.body).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.format).toBe('jpeg');
    expect(stored!.contentType).toBe('image/jpeg');
    expect(asset).toMatchObject({ contentType: 'image/jpeg', width: 64, height: 48, byteSize: stored!.body.length });

    const audit = await fixturePrisma.auditLogEntry.findFirst({ where: { entityId: asset.id, action: 'media.upload' } });
    expect(audit?.outcome).toBe('SUCCESS');
  });

  it('applies the EXIF orientation before stripping it, so photos are not stored sideways', async () => {
    const { child, educatorUser } = await setup('UploadRotate');
    // 64x48 landscape pixels with orientation 6 (rotate 90° clockwise) displays as 48x64 portrait.
    const rotated = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#336699' } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const asset = await media.upload(educatorUser, { buffer: rotated, mimetype: 'image/jpeg', size: rotated.length }, { childIds: [child.id] });

    expect(asset).toMatchObject({ width: 48, height: 64 });
  });

  it('rejects file types other than JPEG, PNG and WebP, and anything over 15 MB', async () => {
    const { child, educatorUser } = await setup('UploadReject');
    const text = Buffer.from('not an image');
    await expect(
      media.upload(educatorUser, { buffer: text, mimetype: 'application/pdf', size: text.length }, { childIds: [child.id] }),
    ).rejects.toThrow(/type/i);
    await expect(
      media.upload(educatorUser, { buffer: text, mimetype: 'image/jpeg', size: 16 * 1024 * 1024 }, { childIds: [child.id] }),
    ).rejects.toThrow(/15 MB/);
    // Declared as an image but isn't one: rejected by the decoder, nothing stored.
    const before = storage.size();
    await expect(
      media.upload(educatorUser, { buffer: text, mimetype: 'image/png', size: text.length }, { childIds: [child.id] }),
    ).rejects.toThrow();
    expect(storage.size()).toBe(before);
  });

  it('a parent cannot upload, and an educator cannot tag a child outside their rooms', async () => {
    const { child, guardianUser } = await setup('UploadDeny');
    const other = await setup('UploadDenyOther');
    const img = await jpegWithGps();
    const before = storage.size();
    await expect(media.upload(guardianUser, { buffer: img, mimetype: 'image/jpeg', size: img.length }, { childIds: [child.id] })).rejects.toThrow();
    await expect(
      media.upload(other.educatorUser, { buffer: img, mimetype: 'image/jpeg', size: img.length }, { childIds: [child.id] }),
    ).rejects.toThrow();
    expect(storage.size()).toBe(before);
  });

  it('issues a 5-minute view URL to an allowed guardian and audits the view', async () => {
    const { child, educatorUser, guardianUser } = await setup('ViewAllowed');
    const img = await jpegWithGps();
    const asset = await media.upload(educatorUser, { buffer: img, mimetype: 'image/jpeg', size: img.length }, { childIds: [child.id] });

    const view = await media.getViewUrl(guardianUser, asset.id);

    expect(view.url).toContain(asset.storageKey);
    expect(view.expiresInSeconds).toBe(300);
    expect(storage.lastPresign).toMatchObject({ key: asset.storageKey, expiresInSeconds: 300 });
    const audit = await fixturePrisma.auditLogEntry.findFirst({ where: { entityId: asset.id, action: 'media.view', actorUserId: guardianUser.userId } });
    expect(audit?.outcome).toBe('SUCCESS');
  });

  it('refuses a view URL when the guardian has media permission turned off, and audits the denial', async () => {
    const { child, educatorUser, guardianUser } = await setup('ViewDenied', false);
    const img = await jpegWithGps();
    const asset = await media.upload(educatorUser, { buffer: img, mimetype: 'image/jpeg', size: img.length }, { childIds: [child.id] });

    await expect(media.getViewUrl(guardianUser, asset.id)).rejects.toThrow(/not authorized/i);
    const audit = await fixturePrisma.auditLogEntry.findFirst({ where: { entityId: asset.id, action: 'media.view', actorUserId: guardianUser.userId } });
    expect(audit?.outcome).toBe('DENIED');
  });
});
