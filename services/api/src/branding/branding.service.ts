import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { isIP } from 'net';
import { promises as dns } from 'dns';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { OrganisationBrand, OrganisationDomain } from '@prisma/client';
import sharp from 'sharp';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RequestUser } from '../authorization/request-user.interface';
import { DEFAULT_BRAND } from './brand-defaults';
import { contrastRatio, MIN_TEXT_CONTRAST } from './contrast';

export const DOMAIN_VERIFIER = 'DOMAIN_VERIFIER';

/** The shape of `dns.promises.resolveTxt`, so tests can supply records without a network. */
export interface DomainVerifier {
  resolveTxt(name: string): Promise<string[][]>;
}

export const defaultDomainVerifier: DomainVerifier = { resolveTxt: (name) => dns.resolveTxt(name) };

export interface BrandView {
  displayName: string;
  primaryColor: string;
  welcomeMessage: string | null;
  philosophy: string | null;
  logoUrl: string | null;
  isCustom: boolean;
}

/** What the public sign-in screens may see: no philosophy statement, which is for signed-in families. */
export type PublicBrandView = Omit<BrandView, 'philosophy'>;

export interface DomainView {
  id: string;
  hostname: string;
  status: 'PENDING' | 'ACTIVE';
  verifiedAt: Date | null;
  verification: { recordName: string; recordValue: string } | null;
}

const ORG_ADMIN_ROLES: RequestUser['role'][] = ['ORG_ADMIN', 'PLATFORM_ADMIN'];
const MAX_LOGO_BYTES = 512 * 1024;
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
// The declared type must match what the bytes really are.
const FORMAT_FOR_TYPE: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' };
const MAX_DOMAINS_PER_ORG = 5;
const UNSAFE_TEXT = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‎‏‪-‮⁦-⁩]/g;
const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

const cleanText = (value: string | undefined | null): string | null => {
  const cleaned = (value ?? '').replace(UNSAFE_TEXT, '').trim();
  return cleaned ? cleaned : null;
};

/**
 * Lower-case host without a trailing dot, or null when it cannot be a hostname. A port is dropped only when
 * reading a request's host (`allowPort`); a domain someone registers must not contain one.
 */
function normaliseHost(raw: string | undefined | null, allowPort = false): string | null {
  if (typeof raw !== 'string') return null;
  let host = raw.trim().toLowerCase();
  if (allowPort) host = host.replace(/:\d{1,5}$/, '');
  host = host.replace(/\.$/, '');
  if (!host || host.length > 253 || /[\u0000- /\\@?#*:\s]/.test(host)) return null;
  const labels = host.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l)) || !/^[a-z]{2,63}$/.test(labels[labels.length - 1])) return null;
  return isIP(host) ? null : host;
}

/**
 * White label levels 1 and 2 (BRD v2.3 CUS-004): one brand per organisation and the web addresses an
 * organisation serves the portal from. The brand, domain and plan tables sit outside row-level security
 * because the public sign-in screens read them before an organisation is known, so every write here is
 * scoped to the caller's own organisation in code. Audit entries name the fields that changed, never the values.
 */
@Injectable()
export class BrandingService {
  private readonly verifier: DomainVerifier;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() @Inject(DOMAIN_VERIFIER) verifier?: DomainVerifier,
  ) {
    this.verifier = verifier ?? defaultDomainVerifier;
  }

  // ----------------------------------------------------------------- helpers

  private requireOrgAdmin(user: RequestUser): string {
    if (!user.orgId || !ORG_ADMIN_ROLES.includes(user.role)) throw new ForbiddenException('Only an organisation administrator can change branding');
    return user.orgId;
  }

  private view(orgId: string, row: OrganisationBrand | null): BrandView {
    return {
      displayName: row?.displayName ?? DEFAULT_BRAND.displayName,
      primaryColor: row?.primaryColor ?? DEFAULT_BRAND.primaryColor,
      welcomeMessage: row?.welcomeMessage ?? null,
      philosophy: row?.philosophy ?? null,
      logoUrl: row?.logoData ? `/branding/logo/${orgId}?v=${row.logoVersion}` : null,
      isCustom: row !== null,
    };
  }

  private publicView(orgId: string, row: OrganisationBrand | null): PublicBrandView {
    const { philosophy: _omitted, ...rest } = this.view(orgId, row);
    return rest;
  }

  private async record(user: RequestUser, action: string, metadata: Record<string, unknown>) {
    await this.audit.record({
      orgId: user.orgId as string,
      centreId: user.centreId,
      actorUserId: user.userId,
      actorRole: user.role,
      action,
      entityType: 'Organisation',
      entityId: user.orgId as string,
      outcome: 'SUCCESS',
      metadata,
    });
  }

  private domainView(d: OrganisationDomain): DomainView {
    return {
      id: d.id,
      hostname: d.hostname,
      status: d.status,
      verifiedAt: d.verifiedAt,
      verification:
        d.status === 'PENDING' ? { recordName: `_childcare-verify.${d.hostname}`, recordValue: `childcare-verify=${d.verificationToken}` } : null,
    };
  }

  // ------------------------------------------------------------------- brand

  async getBrand(user: RequestUser): Promise<BrandView> {
    if (!user.orgId) throw new ForbiddenException();
    return this.view(user.orgId, await this.prisma.organisationBrand.findUnique({ where: { orgId: user.orgId } }));
  }

  /** The brand for a web address, before anyone has signed in. Unknown, pending or malformed hosts get the default; nothing is revealed about them. */
  async getPublicBrandForHost(hostname: string): Promise<PublicBrandView> {
    const fallback = this.publicView('', null);
    const host = normaliseHost(hostname, true);
    if (!host) return fallback;
    try {
      const domain = await this.prisma.organisationDomain.findFirst({ where: { hostname: host, status: 'ACTIVE' } });
      if (!domain) return fallback;
      return this.publicView(domain.orgId, await this.prisma.organisationBrand.findUnique({ where: { orgId: domain.orgId } }));
    } catch {
      return fallback;
    }
  }

  async updateBrand(
    user: RequestUser,
    input: { displayName: string; primaryColor: string; welcomeMessage?: string; philosophy?: string },
  ): Promise<BrandView> {
    const orgId = this.requireOrgAdmin(user);

    const displayName = cleanText(input.displayName);
    if (!displayName || displayName.length < 2 || displayName.length > 60) throw new BadRequestException('The display name must be 2 to 60 characters');
    if (typeof input.primaryColor !== 'string' || !HEX_COLOUR.test(input.primaryColor)) throw new BadRequestException('The colour must look like #0f766e');
    const primaryColor = input.primaryColor.toLowerCase();
    if (contrastRatio(primaryColor, '#ffffff') < MIN_TEXT_CONTRAST) {
      throw new BadRequestException('Choose a darker colour: white text on it must have a contrast ratio of at least 4.5:1');
    }
    const welcomeMessage = input.welcomeMessage === undefined ? undefined : cleanText(input.welcomeMessage);
    if (welcomeMessage && welcomeMessage.length > 300) throw new BadRequestException('The welcome message can be at most 300 characters');
    const philosophy = input.philosophy === undefined ? undefined : cleanText(input.philosophy);
    if (philosophy && philosophy.length > 2000) throw new BadRequestException('The philosophy statement can be at most 2000 characters');

    const existing = await this.prisma.organisationBrand.findUnique({ where: { orgId } });
    const next = {
      displayName,
      primaryColor,
      welcomeMessage: welcomeMessage === undefined ? (existing?.welcomeMessage ?? null) : welcomeMessage,
      philosophy: philosophy === undefined ? (existing?.philosophy ?? null) : philosophy,
    };

    // Names of what changed (everything provided on a first save); never the values.
    const provided: [string, unknown, unknown][] = [
      ['displayName', existing?.displayName, next.displayName],
      ['primaryColor', existing?.primaryColor, next.primaryColor],
    ];
    if (welcomeMessage !== undefined) provided.push(['welcomeMessage', existing?.welcomeMessage ?? null, next.welcomeMessage]);
    if (philosophy !== undefined) provided.push(['philosophy', existing?.philosophy ?? null, next.philosophy]);
    const changed = provided.filter(([, before, after]) => !existing || before !== after).map(([name]) => name);
    if (existing && changed.length === 0) return this.view(orgId, existing);

    const row = await this.prisma.organisationBrand.upsert({
      where: { orgId },
      create: { orgId, ...next, updatedByUserId: user.userId },
      update: { ...next, updatedByUserId: user.userId },
    });
    await this.record(user, 'branding.updated', { fields: changed });
    return this.view(orgId, row);
  }

  // -------------------------------------------------------------------- logo

  /** The public logo for an organisation, or null. */
  async getLogo(orgId: string): Promise<{ data: Buffer; contentType: string; version: number } | null> {
    if (typeof orgId !== 'string' || !orgId) return null;
    const row = await this.prisma.organisationBrand.findUnique({ where: { orgId } }).catch(() => null);
    if (!row?.logoData) return null;
    return { data: Buffer.from(row.logoData), contentType: row.logoContentType ?? 'image/png', version: row.logoVersion };
  }

  async setLogo(user: RequestUser, file: { buffer: Buffer; mimetype: string }): Promise<BrandView> {
    const orgId = this.requireOrgAdmin(user);
    if (!file?.buffer || !LOGO_TYPES.includes(file.mimetype)) throw new BadRequestException('The logo must be a PNG, JPEG or WebP image');
    if (file.buffer.length > MAX_LOGO_BYTES) throw new BadRequestException('The logo must be 512 KB or smaller');

    // Decoded and re-encoded here: the stored file is always a small PNG we made, whatever was uploaded.
    let png: Buffer;
    try {
      const probe = await sharp(file.buffer, { limitInputPixels: 25_000_000 }).metadata();
      if (probe.format !== FORMAT_FOR_TYPE[file.mimetype]) throw new Error('type does not match the file');
      png = await sharp(file.buffer, { limitInputPixels: 25_000_000 })
        .rotate()
        .resize({ width: 600, height: 300, fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();
    } catch {
      throw new BadRequestException('That file is not a usable image');
    }

    const existing = await this.prisma.organisationBrand.findUnique({ where: { orgId } });
    const logoVersion = (existing?.logoVersion ?? 0) + 1;
    await this.prisma.organisationBrand.upsert({
      where: { orgId },
      create: { orgId, ...DEFAULT_BRAND, logoData: png, logoContentType: 'image/png', logoVersion, updatedByUserId: user.userId },
      update: { logoData: png, logoContentType: 'image/png', logoVersion, updatedByUserId: user.userId },
    });
    await this.record(user, 'branding.logo_set', { logoVersion });
    return this.getBrand(user);
  }

  async removeLogo(user: RequestUser): Promise<BrandView> {
    const orgId = this.requireOrgAdmin(user);
    const existing = await this.prisma.organisationBrand.findUnique({ where: { orgId } });
    if (existing?.logoData) {
      await this.prisma.organisationBrand.update({
        where: { orgId },
        data: { logoData: null, logoContentType: null, logoVersion: existing.logoVersion + 1, updatedByUserId: user.userId },
      });
      await this.record(user, 'branding.logo_removed', {});
    }
    return this.getBrand(user);
  }

  // ----------------------------------------------------------------- domains

  async listDomains(user: RequestUser): Promise<DomainView[]> {
    const orgId = this.requireOrgAdmin(user);
    const rows = await this.prisma.organisationDomain.findMany({ where: { orgId }, orderBy: { createdAt: 'asc' } });
    return rows.map((r) => this.domainView(r));
  }

  async addDomain(user: RequestUser, hostname: string): Promise<DomainView> {
    const orgId = this.requireOrgAdmin(user);
    const host = normaliseHost(hostname);
    if (!host) throw new BadRequestException('Enter a domain name such as portal.yourcentre.com.au (no http://, port, path or wildcard)');
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new BadRequestException('That domain cannot be used');
    const platform = (process.env.PLATFORM_DOMAIN ?? '').trim().toLowerCase();
    if (platform && (host === platform || host.endsWith(`.${platform}`))) throw new BadRequestException('That domain belongs to the platform and cannot be used');

    if ((await this.prisma.organisationDomain.count({ where: { orgId } })) >= MAX_DOMAINS_PER_ORG) {
      throw new ConflictException(`An organisation can have at most ${MAX_DOMAINS_PER_ORG} domains`);
    }
    // The message does not say who holds it.
    const taken = new ConflictException('That domain is already in use');
    if (await this.prisma.organisationDomain.findUnique({ where: { hostname: host } })) throw taken;

    let row: OrganisationDomain;
    try {
      row = await this.prisma.organisationDomain.create({ data: { orgId, hostname: host, verificationToken: randomBytes(16).toString('hex') } });
    } catch (err) {
      if ((err as { code?: string }).code === UNIQUE_CONSTRAINT_VIOLATION) throw taken;
      throw err;
    }
    await this.record(user, 'domain.added', { domainId: row.id, hostname: host });
    return this.domainView(row);
  }

  /** Active only once the organisation proves control by publishing the DNS TXT record we gave it. */
  async verifyDomain(user: RequestUser, domainId: string): Promise<DomainView> {
    const orgId = this.requireOrgAdmin(user);
    const domain = await this.prisma.organisationDomain.findFirst({ where: { id: domainId, orgId } });
    if (!domain) throw new NotFoundException('Domain not found');
    if (domain.status === 'ACTIVE') return this.domainView(domain);

    const expected = `childcare-verify=${domain.verificationToken}`;
    let records: string[][] = [];
    try {
      records = await this.verifier.resolveTxt(`_childcare-verify.${domain.hostname}`);
    } catch {
      /* not published yet, or no such name */
    }
    if (!records.some((chunks) => chunks.join('') === expected)) throw new ConflictException('DNS record not found yet');

    const claimed = await this.prisma.organisationDomain.updateMany({ where: { id: domain.id, status: 'PENDING' }, data: { status: 'ACTIVE', verifiedAt: new Date() } });
    const current = await this.prisma.organisationDomain.findUniqueOrThrow({ where: { id: domain.id } });
    if (claimed.count === 1) await this.record(user, 'domain.verified', { domainId: domain.id, hostname: domain.hostname });
    return this.domainView(current);
  }

  async removeDomain(user: RequestUser, domainId: string): Promise<void> {
    const orgId = this.requireOrgAdmin(user);
    const domain = await this.prisma.organisationDomain.findFirst({ where: { id: domainId, orgId } });
    if (!domain) throw new NotFoundException('Domain not found');
    await this.prisma.organisationDomain.deleteMany({ where: { id: domain.id, orgId } });
    await this.record(user, 'domain.removed', { domainId: domain.id, hostname: domain.hostname });
  }

  async isActiveDomain(hostname: string): Promise<boolean> {
    const host = normaliseHost(hostname);
    if (!host) return false;
    try {
      return (await this.prisma.organisationDomain.count({ where: { hostname: host, status: 'ACTIVE' } })) > 0;
    } catch {
      return false;
    }
  }

  /** Caddy asks this before requesting a certificate. The shared token keeps strangers from probing which hosts exist. */
  async domainCheck(domain: string, token: string | undefined): Promise<boolean> {
    const expected = process.env.DOMAIN_CHECK_TOKEN;
    if (!expected || typeof token !== 'string') return false;
    const digest = (v: string) => createHash('sha256').update(v).digest();
    if (!timingSafeEqual(digest(expected), digest(token))) return false;
    return this.isActiveDomain(domain);
  }

  /** CORS: the portal served from a verified custom domain may call the API. https only, no port, path or credentials. */
  async isAllowedOrigin(origin: string): Promise<boolean> {
    try {
      const url = new URL(origin);
      if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return false;
      // An Origin header is exactly scheme://host[:443]: no trailing slash and nothing after the host.
      const exact = origin.trim().toLowerCase();
      if (exact !== `https://${url.hostname}` && exact !== `https://${url.hostname}:443`) return false;
      return await this.isActiveDomain(url.hostname);
    } catch {
      return false;
    }
  }
}
