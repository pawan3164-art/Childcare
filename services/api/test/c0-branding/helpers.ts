import sharp from 'sharp';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { RequestUser } from '../../src/authorization/request-user.interface';
import { BrandingService } from '../../src/branding/branding.service';
import { fixturePrisma, seedOrgCentreRoom, SeededTenant, uniqueSuffix } from '../test-utils';

/** New models may not be in every generated client; fixtures go through any. */
export const db: any = fixturePrisma;

export type TestUser = RequestUser & { email: string };

export interface FakeVerifier {
  records: Record<string, string[][] | Error>;
  resolveTxt(name: string): Promise<string[][]>;
}

export function fakeVerifier(): FakeVerifier {
  const v: FakeVerifier = {
    records: {},
    async resolveTxt(name: string) {
      const r = v.records[name];
      if (!r) throw Object.assign(new Error(`queryTxt ENOTFOUND ${name}`), { code: 'ENOTFOUND' });
      if (r instanceof Error) throw r;
      return r;
    },
  };
  return v;
}

export async function buildBranding() {
  const prismaService = new PrismaService();
  await prismaService.onModuleInit();
  const tenancy = new TenancyService(prismaService);
  const audit = new AuditService(tenancy);
  const verifier = fakeVerifier();
  const service = new BrandingService(prismaService, audit, verifier);
  return { prismaService, tenancy, audit, verifier, service };
}

export async function makeUser(tenant: { orgId: string; centreId: string }, role: RequestUser['role']): Promise<TestUser> {
  const email = `${role.toLowerCase()}-${uniqueSuffix()}@example.test`;
  const u = await fixturePrisma.user.create({
    data: { orgId: tenant.orgId, centreId: tenant.centreId, email, passwordHash: `hash-${uniqueSuffix()}`, role, firstName: role, lastName: 'T' },
  });
  return { userId: u.id, orgId: tenant.orgId, centreId: tenant.centreId, role, sessionId: 's', email };
}

export interface TwoOrgs {
  a: SeededTenant;
  b: SeededTenant;
  adminA: TestUser;
  adminB: TestUser;
}

export async function twoOrgs(): Promise<TwoOrgs> {
  const a = await seedOrgCentreRoom('brandA');
  const b = await seedOrgCentreRoom('brandB');
  return { a, b, adminA: await makeUser(a, 'ORG_ADMIN'), adminB: await makeUser(b, 'ORG_ADMIN') };
}

export async function nonAdmins(t: SeededTenant): Promise<TestUser[]> {
  return [await makeUser(t, 'CENTRE_ADMIN'), await makeUser(t, 'EDUCATOR'), await makeUser(t, 'PARENT')];
}

export async function auditFor(orgId: string, action: string, entityId?: string) {
  return fixturePrisma.auditLogEntry.findMany({ where: { orgId, action, ...(entityId ? { entityId } : {}) } });
}

export async function brandRow(orgId: string): Promise<any> {
  return db.organisationBrand.findUnique({ where: { orgId } });
}

export async function domainRow(id: string): Promise<any> {
  return db.organisationDomain.findUnique({ where: { id } });
}

export function uniqueHost(label = 'kids'): string {
  return `${label}-${uniqueSuffix().replace(/_/g, '-')}.example.com`;
}

export async function image(
  width: number,
  height: number,
  fmt: 'png' | 'jpeg' | 'webp' | 'gif' = 'png',
  background = { r: 20, g: 120, b: 100 },
): Promise<Buffer> {
  const s = sharp({ create: { width, height, channels: 3, background } });
  if (fmt === 'jpeg') return s.jpeg().toBuffer();
  if (fmt === 'webp') return s.webp().toBuffer();
  if (fmt === 'gif') return s.gif().toBuffer();
  return s.png().toBuffer();
}

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
