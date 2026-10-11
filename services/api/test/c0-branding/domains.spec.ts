import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { BrandingService } from '../../src/branding/branding.service';
import { DEFAULT_BRAND } from '../../src/branding/brand-defaults';
import { disconnectAll } from '../test-utils';
import { auditFor, buildBranding, domainRow, FakeVerifier, nonAdmins, twoOrgs, TwoOrgs, uniqueHost } from './helpers';

describe('C0 branding: custom domains (white label level 2)', () => {
  let svc: BrandingService;
  let verifier: FakeVerifier;
  let prismaService: { onModuleDestroy?: () => Promise<void> };
  let o: TwoOrgs;
  const savedEnv = { pd: process.env.PLATFORM_DOMAIN, dct: process.env.DOMAIN_CHECK_TOKEN };

  beforeAll(async () => {
    const b = await buildBranding();
    svc = b.service;
    verifier = b.verifier;
    prismaService = b.prismaService as any;
  });

  beforeEach(async () => {
    process.env.PLATFORM_DOMAIN = 'platform.test';
    delete process.env.DOMAIN_CHECK_TOKEN;
    o = await twoOrgs();
  });

  afterAll(async () => {
    if (savedEnv.pd === undefined) delete process.env.PLATFORM_DOMAIN;
    else process.env.PLATFORM_DOMAIN = savedEnv.pd;
    if (savedEnv.dct === undefined) delete process.env.DOMAIN_CHECK_TOKEN;
    else process.env.DOMAIN_CHECK_TOKEN = savedEnv.dct;
    await prismaService.onModuleDestroy?.();
    await disconnectAll();
  });

  /** Adds a domain and publishes its TXT record in the fake resolver. */
  async function publish(user: TwoOrgs['adminA'], host: string, chunks = false) {
    const d = await svc.addDomain(user, host);
    const value = d.verification!.recordValue;
    verifier.records[d.verification!.recordName] = chunks ? [[value.slice(0, 10), value.slice(10)]] : [['unrelated'], [value]];
    return d;
  }

  describe('addDomain', () => {
    it('returns a PENDING view with a verification block and a random per-domain token', async () => {
      const host = uniqueHost('add');
      const d = await svc.addDomain(o.adminA, host);
      expect(d).toEqual({
        id: expect.any(String),
        hostname: host,
        status: 'PENDING',
        verifiedAt: null,
        verification: { recordName: `_childcare-verify.${host}`, recordValue: expect.stringMatching(/^childcare-verify=[0-9a-f]{32,}$/) },
      });
      const d2 = await svc.addDomain(o.adminA, uniqueHost('add'));
      expect(d2.verification!.recordValue).not.toBe(d.verification!.recordValue);
      const row = await domainRow(d.id);
      expect(row.orgId).toBe(o.a.orgId);
      expect(`childcare-verify=${row.verificationToken}`).toBe(d.verification!.recordValue);
    });

    it('normalises: trim, lowercase, trailing dot removed', async () => {
      const host = uniqueHost('norm');
      const d = await svc.addDomain(o.adminA, `  ${host.toUpperCase()}.  `);
      expect(d.hostname).toBe(host);
      expect(d.verification!.recordName).toBe(`_childcare-verify.${host}`);
    });

    it('accepts valid names (hyphens inside labels, deep subdomains, 63 char label)', async () => {
      const s = uniqueHost('ok').replace('.example.com', '');
      for (const h of [`a-b.${s}.com`, `deep.sub.${s}.com.au`, `${'a'.repeat(63)}.${s}.org`]) {
        await expect(svc.addDomain(o.adminA, h)).resolves.toMatchObject({ hostname: h });
        await svc.removeDomain(o.adminA, (await svc.listDomains(o.adminA)).find((x) => x.hostname === h)!.id);
      }
    });

    it('rejects invalid hostnames', async () => {
      const bad = [
        '', '   ', '.', '192.168.1.1', '10.0.0.1', '::1', '[::1]', '2001:db8::1', 'a.com:8080', '*.a.com', '*', 'https://a.com', 'http://a.com',
        'a.com/x', 'a.com/', 'localhost', 'LOCALHOST', 'singlelabel', 'a.local', 'x.y.local', 'a.internal', 'svc.corp.internal',
        '-a.com', 'a-.com', 'a..com', '.a.com', 'a_b.com', 'a b.com', 'a.c0m', 'a.123', `${'a'.repeat(64)}.com`,
        `${Array(5).fill('a'.repeat(60)).join('.')}.com`, 'a.com?x=1', 'a.com#frag', 'user@a.com', 'a.com\u0000', 'ex‮ample.com',
        'platform.test', 'portal.platform.test', 'A.B.Platform.Test', 'platform.test.',
      ];
      for (const h of bad) {
        await expect(svc.addDomain(o.adminA, h)).rejects.toBeInstanceOf(BadRequestException);
      }
      expect(await svc.listDomains(o.adminA)).toHaveLength(0);
    });

    it('reads PLATFORM_DOMAIN at call time', async () => {
      process.env.PLATFORM_DOMAIN = 'other-platform.test';
      await expect(svc.addDomain(o.adminA, 'portal.other-platform.test')).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.addDomain(o.adminA, uniqueHost('fine').replace('example.com', 'platform.test.example.net'))).resolves.toBeDefined();
    });

    it('a host that only ends with the platform domain text (not a subdomain) is allowed', async () => {
      const h = `notplatform.test`;
      await expect(svc.addDomain(o.adminA, h)).resolves.toMatchObject({ hostname: h });
      await svc.removeDomain(o.adminA, (await svc.listDomains(o.adminA))[0].id);
    });

    it('the same hostname registered by any org conflicts without naming the other org', async () => {
      const host = uniqueHost('dup');
      await svc.addDomain(o.adminB, host);
      for (const attempt of [host, host.toUpperCase(), `${host}.`]) {
        const err: any = await svc.addDomain(o.adminA, attempt).catch((e) => e);
        expect(err).toBeInstanceOf(ConflictException);
        expect(String(err.message)).not.toContain(o.b.orgId);
        expect(String(err.message)).not.toContain(o.adminB.userId);
        expect(JSON.stringify(err.getResponse())).not.toContain(o.b.orgId);
      }
      await expect(svc.addDomain(o.adminB, host)).rejects.toBeInstanceOf(ConflictException);
    });

    it('conflicts with an ACTIVE domain of another org too', async () => {
      const host = uniqueHost('dupact');
      await publish(o.adminB, host);
      await svc.verifyDomain(o.adminB, (await svc.listDomains(o.adminB))[0].id);
      await expect(svc.addDomain(o.adminA, host)).rejects.toBeInstanceOf(ConflictException);
    });

    it('allows at most 5 domains per org', async () => {
      for (let i = 0; i < 5; i++) await svc.addDomain(o.adminA, uniqueHost(`cap${i}`));
      await expect(svc.addDomain(o.adminA, uniqueHost('cap6'))).rejects.toBeInstanceOf(ConflictException);
      await expect(svc.addDomain(o.adminB, uniqueHost('capb'))).resolves.toBeDefined();
    });

    it('non-admin roles are Forbidden', async () => {
      for (const u of await nonAdmins(o.a)) {
        await expect(svc.addDomain(u, uniqueHost('forb'))).rejects.toBeInstanceOf(ForbiddenException);
      }
      expect(await svc.listDomains(o.adminA)).toHaveLength(0);
    });

    it('audits domain.added with domainId and hostname only', async () => {
      const host = uniqueHost('aud');
      const d = await svc.addDomain(o.adminA, host);
      const entries = await auditFor(o.a.orgId, 'domain.added');
      expect(entries).toHaveLength(1);
      expect(entries[0].metadata).toEqual({ domainId: d.id, hostname: host });
      expect(JSON.stringify(entries[0].metadata)).not.toContain('childcare-verify');
      expect(entries[0].actorUserId).toBe(o.adminA.userId);
    });
  });

  describe('listDomains', () => {
    it("lists only the caller's own org, ordered by createdAt, with verification only while PENDING", async () => {
      const h1 = uniqueHost('l1');
      const h2 = uniqueHost('l2');
      const hb = uniqueHost('lb');
      const d1 = await publish(o.adminA, h1);
      const d2 = await svc.addDomain(o.adminA, h2);
      await svc.addDomain(o.adminB, hb);
      await svc.verifyDomain(o.adminA, d1.id);
      const list = await svc.listDomains(o.adminA);
      expect(list.map((d) => d.hostname)).toEqual([h1, h2]);
      expect(list[0]).toMatchObject({ status: 'ACTIVE', verification: null, verifiedAt: expect.any(Date) });
      expect(list[1]).toMatchObject({ id: d2.id, status: 'PENDING', verification: d2.verification });
      expect(JSON.stringify(list)).not.toContain(hb);
    });

    it('non-admin roles are Forbidden', async () => {
      for (const u of await nonAdmins(o.a)) await expect(svc.listDomains(u)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('verifyDomain', () => {
    it('activates when the TXT record matches (any record, chunks joined)', async () => {
      const d = await publish(o.adminA, uniqueHost('v1'));
      const view = await svc.verifyDomain(o.adminA, d.id);
      expect(view).toMatchObject({ id: d.id, status: 'ACTIVE', verification: null });
      expect(view.verifiedAt).toBeInstanceOf(Date);
      const row = await domainRow(d.id);
      expect(row.status).toBe('ACTIVE');
      expect(row.verifiedAt).not.toBeNull();
      expect(await auditFor(o.a.orgId, 'domain.verified')).toHaveLength(1);
    });

    it('joins the chunks of a split TXT record', async () => {
      const d = await publish(o.adminA, uniqueHost('v2'), true);
      await expect(svc.verifyDomain(o.adminA, d.id)).resolves.toMatchObject({ status: 'ACTIVE' });
    });

    it('queries the _childcare-verify name through the injected verifier', async () => {
      const calls: string[] = [];
      const spy = verifier.resolveTxt.bind(verifier);
      verifier.resolveTxt = async (n: string) => {
        calls.push(n);
        return spy(n);
      };
      const d = await publish(o.adminA, uniqueHost('v3'));
      await svc.verifyDomain(o.adminA, d.id);
      verifier.resolveTxt = spy;
      expect(calls).toEqual([d.verification!.recordName]);
    });

    it('is a Conflict ("DNS record not found yet") when the record is missing, wrong, or the resolver throws', async () => {
      const d = await svc.addDomain(o.adminA, uniqueHost('v4'));
      // missing: fake resolver throws ENOTFOUND
      await expect(svc.verifyDomain(o.adminA, d.id)).rejects.toThrow('DNS record not found yet');
      await expect(svc.verifyDomain(o.adminA, d.id)).rejects.toBeInstanceOf(ConflictException);
      // wrong value
      verifier.records[d.verification!.recordName] = [['childcare-verify=' + '0'.repeat(32)]];
      await expect(svc.verifyDomain(o.adminA, d.id)).rejects.toBeInstanceOf(ConflictException);
      // prefix or substring is not equality
      verifier.records[d.verification!.recordName] = [[d.verification!.recordValue + 'x'], [' ' + d.verification!.recordValue]];
      await expect(svc.verifyDomain(o.adminA, d.id)).rejects.toBeInstanceOf(ConflictException);
      // generic resolver failure
      verifier.records[d.verification!.recordName] = new Error('SERVFAIL');
      await expect(svc.verifyDomain(o.adminA, d.id)).rejects.toBeInstanceOf(ConflictException);
      expect((await domainRow(d.id)).status).toBe('PENDING');
      expect((await domainRow(d.id)).verifiedAt).toBeNull();
      expect(await auditFor(o.a.orgId, 'domain.verified')).toHaveLength(0);
    });

    it('is idempotent when already ACTIVE: returns the view and writes no second audit entry', async () => {
      const d = await publish(o.adminA, uniqueHost('v5'));
      const first = await svc.verifyDomain(o.adminA, d.id);
      verifier.records = {}; // even with DNS gone, an ACTIVE domain stays ACTIVE
      const second = await svc.verifyDomain(o.adminA, d.id);
      expect(second).toMatchObject({ id: d.id, status: 'ACTIVE' });
      expect(second.verifiedAt).toEqual(first.verifiedAt);
      expect(await auditFor(o.a.orgId, 'domain.verified')).toHaveLength(1);
    });

    it("another org's domain id is NotFound, and the domain is not activated", async () => {
      const d = await publish(o.adminA, uniqueHost('v6'));
      await expect(svc.verifyDomain(o.adminB, d.id)).rejects.toBeInstanceOf(NotFoundException);
      expect((await domainRow(d.id)).status).toBe('PENDING');
    });

    it('unknown ids are NotFound', async () => {
      await expect(svc.verifyDomain(o.adminA, '00000000-0000-0000-0000-000000000000')).rejects.toBeInstanceOf(NotFoundException);
    });

    it("a different org's TXT value cannot activate the domain (token is per domain)", async () => {
      const mine = await svc.addDomain(o.adminA, uniqueHost('v7'));
      const theirs = await svc.addDomain(o.adminB, uniqueHost('v7b'));
      verifier.records[mine.verification!.recordName] = [[theirs.verification!.recordValue]];
      await expect(svc.verifyDomain(o.adminA, mine.id)).rejects.toBeInstanceOf(ConflictException);
      expect((await domainRow(mine.id)).status).toBe('PENDING');
    });

    it('non-admin roles are Forbidden', async () => {
      const d = await publish(o.adminA, uniqueHost('v8'));
      for (const u of await nonAdmins(o.a)) await expect(svc.verifyDomain(u, d.id)).rejects.toBeInstanceOf(ForbiddenException);
      expect((await domainRow(d.id)).status).toBe('PENDING');
    });
  });

  describe('removeDomain', () => {
    it('deletes the domain, audits domain.removed, and the host then serves the default brand', async () => {
      await svc.updateBrand(o.adminA, { displayName: 'Gone Soon', primaryColor: '#0f766e' });
      const host = uniqueHost('rm');
      const d = await publish(o.adminA, host);
      await svc.verifyDomain(o.adminA, d.id);
      expect((await svc.getPublicBrandForHost(host)).displayName).toBe('Gone Soon');
      await svc.removeDomain(o.adminA, d.id);
      expect(await domainRow(d.id)).toBeNull();
      expect((await svc.getPublicBrandForHost(host)).displayName).toBe(DEFAULT_BRAND.displayName);
      expect(await svc.isActiveDomain(host)).toBe(false);
      const entries = await auditFor(o.a.orgId, 'domain.removed');
      expect(entries).toHaveLength(1);
      expect(entries[0].metadata).toMatchObject({ domainId: d.id, hostname: host });
    });

    it("another org's domain is NotFound and left intact", async () => {
      const d = await svc.addDomain(o.adminA, uniqueHost('rm2'));
      await expect(svc.removeDomain(o.adminB, d.id)).rejects.toBeInstanceOf(NotFoundException);
      expect(await domainRow(d.id)).not.toBeNull();
      expect(await auditFor(o.b.orgId, 'domain.removed')).toHaveLength(0);
    });

    it('non-admin roles are Forbidden', async () => {
      const d = await svc.addDomain(o.adminA, uniqueHost('rm3'));
      for (const u of await nonAdmins(o.a)) await expect(svc.removeDomain(u, d.id)).rejects.toBeInstanceOf(ForbiddenException);
      expect(await domainRow(d.id)).not.toBeNull();
    });

    it('frees the hostname for another org', async () => {
      const host = uniqueHost('rm4');
      const d = await svc.addDomain(o.adminA, host);
      await svc.removeDomain(o.adminA, d.id);
      await expect(svc.addDomain(o.adminB, host)).resolves.toMatchObject({ hostname: host });
    });
  });

  describe('isActiveDomain', () => {
    it('is true only for ACTIVE, case-insensitively', async () => {
      const host = uniqueHost('act');
      const d = await publish(o.adminA, host);
      expect(await svc.isActiveDomain(host)).toBe(false);
      expect(await svc.isActiveDomain(uniqueHost('never'))).toBe(false);
      await svc.verifyDomain(o.adminA, d.id);
      expect(await svc.isActiveDomain(host)).toBe(true);
      expect(await svc.isActiveDomain(host.toUpperCase())).toBe(true);
    });
  });

  describe('domainCheck (TLS certificate check)', () => {
    async function activeHost() {
      const host = uniqueHost('tls');
      const d = await publish(o.adminA, host);
      await svc.verifyDomain(o.adminA, d.id);
      return host;
    }

    it('is false when DOMAIN_CHECK_TOKEN is unset or empty, whatever token is sent', async () => {
      const host = await activeHost();
      delete process.env.DOMAIN_CHECK_TOKEN;
      expect(await svc.domainCheck(host, undefined)).toBe(false);
      expect(await svc.domainCheck(host, '')).toBe(false);
      expect(await svc.domainCheck(host, 'anything')).toBe(false);
      process.env.DOMAIN_CHECK_TOKEN = '';
      expect(await svc.domainCheck(host, '')).toBe(false);
      expect(await svc.domainCheck(host, undefined)).toBe(false);
    });

    it('is false when the token is missing or differs (including different length and prefix)', async () => {
      const host = await activeHost();
      process.env.DOMAIN_CHECK_TOKEN = 'secret-check-token';
      for (const t of [undefined, '', 'wrong', 'secret-check-toke', 'secret-check-token!', 'SECRET-CHECK-TOKEN']) {
        expect(await svc.domainCheck(host, t)).toBe(false);
      }
    });

    it('is true only for an ACTIVE domain with the right token', async () => {
      const host = await activeHost();
      const pending = await svc.addDomain(o.adminA, uniqueHost('tlsp'));
      process.env.DOMAIN_CHECK_TOKEN = 'secret-check-token';
      expect(await svc.domainCheck(host, 'secret-check-token')).toBe(true);
      expect(await svc.domainCheck(host.toUpperCase(), 'secret-check-token')).toBe(true);
      expect(await svc.domainCheck(pending.hostname, 'secret-check-token')).toBe(false);
      expect(await svc.domainCheck(uniqueHost('unk'), 'secret-check-token')).toBe(false);
    });
  });

  describe('isAllowedOrigin (CORS)', () => {
    it('allows only https://<active host> with no path and port 443 or none', async () => {
      const host = uniqueHost('cors');
      const d = await publish(o.adminA, host);
      const pending = await svc.addDomain(o.adminA, uniqueHost('corsp'));
      expect(await svc.isAllowedOrigin(`https://${host}`)).toBe(false); // still pending
      await svc.verifyDomain(o.adminA, d.id);

      expect(await svc.isAllowedOrigin(`https://${host}`)).toBe(true);
      expect(await svc.isAllowedOrigin(`https://${host}:443`)).toBe(true);
      expect(await svc.isAllowedOrigin(`https://${host.toUpperCase()}`)).toBe(true);

      for (const bad of [
        `http://${host}`, `https://${host}:8443`, `https://${host}:80`, `https://${host}/`, `https://${host}/path`, `https://${host}?x=1`,
        `https://${host}.evil.com`, `https://evil.com/${host}`, `https://user@${host}`, `https://sub.${host}`, host, `//${host}`,
        `ftp://${host}`, `https://${pending.hostname}`, `https://${uniqueHost('x')}`, '', 'null', 'https://', 'https://:443', '*', 'not a url',
      ]) {
        expect(await svc.isAllowedOrigin(bad)).toBe(false);
      }
    });
  });
});
