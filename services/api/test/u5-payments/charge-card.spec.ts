import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { disconnectAll, fixturePrisma } from '../test-utils';
import { billingFamily, buildPayments, GatewayMock, IP, key, makeGateway, NOW, TOKEN } from './helpers';

const db = fixturePrisma as any;

describe('PaymentsService.chargeCard', () => {
  let gateway: GatewayMock;
  let payments: any;
  let ledger: any;
  let prismaService: any;

  beforeEach(async () => {
    gateway = makeGateway();
    ({ prismaService, payments, ledger } = await buildPayments(gateway));
  });
  afterEach(async () => {
    await prismaService.onModuleDestroy();
  });
  afterAll(disconnectAll);

  const dto = (childId: string, over: Record<string, unknown> = {}) => ({ childId, amountCents: 5000, cardToken: TOKEN, idempotencyKey: key(), ...over });

  describe('happy path', () => {
    it('charges the gateway, credits the ledger once, records the payment, returns a token-free result', async () => {
      const f = await billingFamily('cc-happy');
      const d = dto(f.child.id);
      const r = await payments.chargeCard(f.parent, d, { ip: IP }, NOW);

      expect(r).toMatchObject({ status: 'SUCCEEDED', amountCents: 5000, card: { brand: 'VISA', last4: '4242' } });
      expect(r.paymentId).toEqual(expect.any(String));
      expect(JSON.stringify(r)).not.toContain(TOKEN);

      expect(gateway.charge).toHaveBeenCalledTimes(1);
      const call = (gateway.charge.mock.calls[0] as any[])[0];
      expect(call).toMatchObject({ amountCents: 5000, cardToken: TOKEN, customerIp: IP });
      expect(call.reference).toContain(d.idempotencyKey);
      expect(call.reference).toBe((gateway.charge.mock.calls[0] as any[])[0].reference); // deterministic string

      const entries = await db.ledgerEntry.findMany({ where: { childId: f.child.id, entryType: 'PAYMENT' } });
      expect(entries).toHaveLength(1);
      expect(entries[0].amountCents).toBe(-5000);

      const rec = await db.paymentRecord.findMany({ where: { childId: f.child.id } });
      expect(rec).toHaveLength(1);
      expect(rec[0]).toMatchObject({ provider: 'MOCK', status: 'SUCCEEDED', amountCents: 5000, ledgerEntryId: entries[0].id });
      expect(rec[0].providerPaymentId).toBe(`gw_${call.reference}`);

      const attempts = await db.paymentAttempt.findMany({ where: { childId: f.child.id } });
      expect(attempts).toHaveLength(1);
      expect(attempts[0]).toMatchObject({ idempotencyKey: d.idempotencyKey, status: 'SUCCEEDED', provider: 'MOCK', amountCents: 5000, providerPaymentId: rec[0].providerPaymentId, actorUserId: f.parent.userId });
      expect(JSON.stringify(attempts[0])).not.toContain(TOKEN);
    });

    it('uses 0.0.0.0 when no IP is known', async () => {
      const f = await billingFamily('cc-noip');
      await payments.chargeCard(f.parent, dto(f.child.id), {}, NOW);
      expect((gateway.charge.mock.calls[0] as any[])[0].customerIp).toBe('0.0.0.0');
    });

    it('ledger balance reflects the payment', async () => {
      const f = await billingFamily('cc-balance');
      await payments.chargeCard(f.parent, dto(f.child.id, { amountCents: 7000 }), { ip: IP }, NOW);
      const b = await ledger.getBreakdown(f.admin, f.child.id);
      expect(b.paymentsCents).toBe(7000);
      expect(b.balanceCents).toBe(-7000);
    });

    it('an admin can charge for a child in their centre', async () => {
      const f = await billingFamily('cc-admin');
      const r = await payments.chargeCard(f.admin, dto(f.child.id), { ip: IP }, NOW);
      expect(r.status).toBe('SUCCEEDED');
    });

    it('writes one audit entry billing.payment.card with ids/amount/status only, never token or IP', async () => {
      const f = await billingFamily('cc-audit');
      const r = await payments.chargeCard(f.parent, dto(f.child.id), { ip: IP }, NOW);
      const rows = await db.auditLogEntry.findMany({ where: { action: 'billing.payment.card', orgId: f.tenant.orgId } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ actorUserId: f.parent.userId, outcome: 'SUCCESS' });
      const text = JSON.stringify(rows[0]);
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain(IP);
      expect(text).toContain('5000');
      expect(text).toContain(r.paymentId);
    });
  });

  describe('idempotency', () => {
    it('the same key twice charges once and returns the first result', async () => {
      const f = await billingFamily('cc-idem');
      const d = dto(f.child.id);
      const a = await payments.chargeCard(f.parent, d, { ip: IP }, NOW);
      const b = await payments.chargeCard(f.parent, d, { ip: IP }, NOW);
      expect(gateway.charge).toHaveBeenCalledTimes(1);
      expect(b).toEqual(a);
      expect(await db.ledgerEntry.count({ where: { childId: f.child.id, entryType: 'PAYMENT' } })).toBe(1);
      expect(await db.paymentAttempt.count({ where: { childId: f.child.id } })).toBe(1);
    });

    it('concurrent calls with the same key charge exactly once', async () => {
      const f = await billingFamily('cc-concurrent');
      const d = dto(f.child.id);
      const results = await Promise.allSettled(Array.from({ length: 5 }, () => payments.chargeCard(f.parent, d, { ip: IP }, NOW)));
      expect(gateway.charge).toHaveBeenCalledTimes(1);
      expect(await db.ledgerEntry.count({ where: { childId: f.child.id, entryType: 'PAYMENT' } })).toBe(1);
      expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    });

    it('a different key is a new charge', async () => {
      const f = await billingFamily('cc-newkey');
      await payments.chargeCard(f.parent, dto(f.child.id), { ip: IP }, NOW);
      await payments.chargeCard(f.parent, dto(f.child.id), { ip: IP }, NOW);
      expect(gateway.charge).toHaveBeenCalledTimes(2);
      expect(await db.ledgerEntry.count({ where: { childId: f.child.id, entryType: 'PAYMENT' } })).toBe(2);
    });

    it('the same key in another org is independent (unique per org)', async () => {
      const a = await billingFamily('cc-key-a');
      const b = await billingFamily('cc-key-b');
      const k = key('shared');
      await payments.chargeCard(a.parent, dto(a.child.id, { idempotencyKey: k }), { ip: IP }, NOW);
      await payments.chargeCard(b.parent, dto(b.child.id, { idempotencyKey: k }), { ip: IP }, NOW);
      expect(gateway.charge).toHaveBeenCalledTimes(2);
    });

    it('a later webhook for the same providerPaymentId is a no-op and never double-credits', async () => {
      const f = await billingFamily('cc-webhook');
      const r = await payments.chargeCard(f.parent, dto(f.child.id), { ip: IP }, NOW);
      const rec = await db.paymentRecord.findUniqueOrThrow({ where: { id: r.paymentId } });
      await payments.processWebhook({ orgId: f.tenant.orgId, centreId: f.tenant.centreId, childId: f.child.id, providerPaymentId: rec.providerPaymentId, amountCents: 5000, status: 'SUCCEEDED' });
      expect(await db.ledgerEntry.count({ where: { childId: f.child.id, entryType: 'PAYMENT' } })).toBe(1);
      expect(await db.paymentRecord.count({ where: { childId: f.child.id } })).toBe(1);
    });
  });

  describe('failures', () => {
    it('a declined card creates no ledger entry, records FAILED, returns the message', async () => {
      gateway.charge.mockResolvedValueOnce({ status: 'FAILED', providerPaymentId: null, message: 'Declined' });
      const f = await billingFamily('cc-decline');
      const d = dto(f.child.id);
      const r = await payments.chargeCard(f.parent, d, { ip: IP }, NOW);
      expect(r).toMatchObject({ status: 'FAILED', message: 'Declined' });
      expect(await db.ledgerEntry.count({ where: { childId: f.child.id, entryType: 'PAYMENT' } })).toBe(0);
      const attempt = await db.paymentAttempt.findFirstOrThrow({ where: { childId: f.child.id } });
      expect(attempt.status).toBe('FAILED');
      expect(JSON.stringify(r)).not.toContain(TOKEN);
      const paid = await db.paymentRecord.findMany({ where: { childId: f.child.id, status: 'SUCCEEDED' } });
      expect(paid).toHaveLength(0);
    });

    it('a declined attempt retried with the same key returns the stored result without calling the gateway', async () => {
      gateway.charge.mockResolvedValueOnce({ status: 'FAILED', providerPaymentId: null, message: 'Declined' });
      const f = await billingFamily('cc-decline-retry');
      const d = dto(f.child.id);
      await payments.chargeCard(f.parent, d, { ip: IP }, NOW);
      const again = await payments.chargeCard(f.parent, d, { ip: IP }, NOW);
      expect(again.status).toBe('FAILED');
      expect(gateway.charge).toHaveBeenCalledTimes(1);
    });

    it('a throwing gateway gives a 5xx with no internals, an UNKNOWN attempt (outcome not confirmed), no ledger entry', async () => {
      gateway.charge.mockRejectedValueOnce(new Error(`ECONNRESET internal-host:443 ${TOKEN}`));
      const f = await billingFamily('cc-throw');
      const d = dto(f.child.id);
      const err = await payments.chargeCard(f.parent, d, { ip: IP }, NOW).catch((e: any) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err.getStatus?.()).toBeGreaterThanOrEqual(500);
      expect(err.getStatus?.()).toBeLessThan(600);
      const text = `${err.message} ${JSON.stringify(err.getResponse?.() ?? '')}`;
      expect(text).not.toContain('ECONNRESET');
      expect(text).not.toContain('internal-host');
      expect(text).not.toContain(TOKEN);
      expect(await db.ledgerEntry.count({ where: { childId: f.child.id, entryType: 'PAYMENT' } })).toBe(0);
      const attempt = await db.paymentAttempt.findFirstOrThrow({ where: { childId: f.child.id } });
      expect(attempt.status).toBe('UNKNOWN');
      // We cannot know the card was not charged, so the message must not claim it.
      expect(text).not.toMatch(/nothing was charged/i);

      // The same key is not retried against the gateway (it could double charge): it waits for confirmation.
      const before = gateway.charge.mock.calls.length;
      await expect(payments.chargeCard(f.parent, d, { ip: IP }, NOW)).rejects.toMatchObject({ status: 409 });
      expect(gateway.charge.mock.calls.length).toBe(before);

      const ok = await payments.chargeCard(f.parent, dto(f.child.id), { ip: IP }, NOW);
      expect(ok.status).toBe('SUCCEEDED');
      expect(await db.ledgerEntry.count({ where: { childId: f.child.id, entryType: 'PAYMENT' } })).toBe(1);
    });
  });

  describe('integrity', () => {
    it('a failure while recording a successful charge leaves the attempt UNKNOWN, not PENDING or FAILED', async () => {
      const f = await billingFamily('cc-record-fail');
      const realRecord = (payments as any).audit.record.bind((payments as any).audit);
      // Only the final audit write fails (the claim audit, written before the charge, goes through).
      const spy = jest.spyOn((payments as any).audit, 'record').mockImplementation(((entry: any, tx: any) => (entry.action === 'billing.payment.card' ? Promise.reject(new Error('audit down')) : realRecord(entry, tx))) as any);
      const d = dto(f.child.id);
      await expect(payments.chargeCard(f.parent, d, { ip: IP }, NOW)).rejects.toMatchObject({ status: 503 });
      spy.mockRestore();
      expect(gateway.charge).toHaveBeenCalledTimes(1);
      expect((await db.paymentAttempt.findFirstOrThrow({ where: { childId: f.child.id } })).status).toBe('UNKNOWN');
      expect(await db.ledgerEntry.count({ where: { childId: f.child.id, entryType: 'PAYMENT' } })).toBe(0);
    });

    it('audits the attempt when it is claimed, before the gateway is called (ids and amount only)', async () => {
      const f = await billingFamily('cc-claim-audit');
      let seenAtCharge = 0;
      gateway.charge.mockImplementationOnce(async (i: any) => {
        seenAtCharge = await db.auditLogEntry.count({ where: { action: 'billing.payment.card_initiated', orgId: f.tenant.orgId } });
        return { status: 'SUCCEEDED', providerPaymentId: `gw_${i.reference}`, message: 'Approved' };
      });
      await payments.chargeCard(f.parent, dto(f.child.id), { ip: IP }, NOW);
      expect(seenAtCharge).toBe(1);
      const row = await db.auditLogEntry.findFirstOrThrow({ where: { action: 'billing.payment.card_initiated', orgId: f.tenant.orgId } });
      expect(JSON.stringify(row)).not.toContain(TOKEN);
      expect(JSON.stringify(row)).not.toContain(IP);
    });

    it('records the payment against the childs own centre', async () => {
      const f = await billingFamily('cc-centre');
      await payments.chargeCard(f.parent, dto(f.child.id), { ip: IP }, NOW);
      const rec = await db.paymentRecord.findFirstOrThrow({ where: { childId: f.child.id } });
      expect(rec.centreId).toBe(f.child.centreId);
    });

    it('logs a structured line for a gateway failure with the attempt id and error class, never the token', async () => {
      const f = await billingFamily('cc-gw-log');
      const warn = jest.spyOn((payments as any).logger, 'warn').mockImplementation(() => undefined);
      gateway.charge.mockRejectedValueOnce(new Error(`boom ${TOKEN}`));
      await payments.chargeCard(f.parent, dto(f.child.id), { ip: IP }, NOW).catch(() => undefined);
      expect(warn).toHaveBeenCalled();
      const logged = JSON.stringify(warn.mock.calls);
      expect(logged).toMatch(/attemptId/);
      expect(logged).not.toContain(TOKEN);
      expect(logged).not.toContain(IP);
    });
  });

  describe('authorization matrix', () => {
    it('a parent of another org cannot pay for the child, and the gateway is never called', async () => {
      const a = await billingFamily('cc-iso-a');
      const b = await billingFamily('cc-iso-b');
      const err = await payments.chargeCard(b.parent, dto(a.child.id), { ip: IP }, NOW).catch((e: any) => e);
      expect(err instanceof ForbiddenException || err instanceof NotFoundException).toBe(true);
      expect(gateway.charge).not.toHaveBeenCalled();
      expect(await db.ledgerEntry.count({ where: { childId: a.child.id } })).toBe(0);
      expect(await db.paymentAttempt.count({ where: { childId: a.child.id } })).toBe(0);
    });

    it('another centre admin (other org) cannot pay for the child either', async () => {
      const a = await billingFamily('cc-iso-admin-a');
      const b = await billingFamily('cc-iso-admin-b');
      await expect(payments.chargeCard(b.admin, dto(a.child.id), { ip: IP }, NOW)).rejects.toThrow();
      expect(gateway.charge).not.toHaveBeenCalled();
    });

    it('a parent without canViewBilling is refused', async () => {
      const f = await billingFamily('cc-nobilling', { canViewBilling: false });
      await expect(payments.chargeCard(f.parent, dto(f.child.id), { ip: IP }, NOW)).rejects.toBeInstanceOf(ForbiddenException);
      expect(gateway.charge).not.toHaveBeenCalled();
    });

    it('a restricted guardian is refused', async () => {
      const f = await billingFamily('cc-restricted', { isRestricted: true });
      await expect(payments.chargeCard(f.parent, dto(f.child.id), { ip: IP }, NOW)).rejects.toBeInstanceOf(ForbiddenException);
      expect(gateway.charge).not.toHaveBeenCalled();
    });

    it('an unlinked parent in the same centre is refused', async () => {
      const f = await billingFamily('cc-unlinked');
      const other = await billingFamily('cc-unlinked-other');
      await expect(payments.chargeCard(other.parent, dto(f.child.id), { ip: IP }, NOW)).rejects.toThrow();
      expect(gateway.charge).not.toHaveBeenCalled();
    });

    it('an educator is refused', async () => {
      const f = await billingFamily('cc-educator');
      await expect(payments.chargeCard(f.educator, dto(f.child.id), { ip: IP }, NOW)).rejects.toBeInstanceOf(ForbiddenException);
      expect(gateway.charge).not.toHaveBeenCalled();
    });

    it("a parent paying for one child leaves another family's ledger untouched and invisible", async () => {
      const a = await billingFamily('cc-vis-a');
      const b = await billingFamily('cc-vis-b');
      await payments.chargeCard(a.parent, dto(a.child.id), { ip: IP }, NOW);
      expect(await db.ledgerEntry.count({ where: { childId: b.child.id } })).toBe(0);
      await expect(ledger.getBreakdown(b.parent, a.child.id)).rejects.toThrow();
    });
  });

  describe('input validation (no gateway call on any)', () => {
    const bad: Array<[string, Record<string, unknown>]> = [
      ['amount 0', { amountCents: 0 }],
      ['negative amount', { amountCents: -1 }],
      ['fractional amount', { amountCents: 10.5 }],
      ['amount above 1,000,000', { amountCents: 1_000_001 }],
      ['string amount', { amountCents: '5000' }],
      ['NaN amount', { amountCents: NaN }],
      ['missing key', { idempotencyKey: undefined }],
      ['key too short', { idempotencyKey: 'short' }],
      ['key too long', { idempotencyKey: 'k'.repeat(101) }],
      ['non-string key', { idempotencyKey: 12345678 }],
      ['missing token', { cardToken: undefined }],
      ['token too long', { cardToken: 'a'.repeat(101) }],
      ['token with illegal chars', { cardToken: 'tok bad;DROP' }],
      ['empty token', { cardToken: '' }],
    ];
    it.each(bad)('rejects %s', async (_n, over) => {
      const f = await billingFamily('cc-validate');
      await expect(payments.chargeCard(f.parent, dto(f.child.id, over), { ip: IP }, NOW)).rejects.toBeInstanceOf(BadRequestException);
      expect(gateway.charge).not.toHaveBeenCalled();
    });

    it('accepts the boundary amounts 1 and 1,000,000', async () => {
      const f = await billingFamily('cc-bounds');
      expect((await payments.chargeCard(f.parent, dto(f.child.id, { amountCents: 1 }), { ip: IP }, NOW)).status).toBe('SUCCEEDED');
      expect((await payments.chargeCard(f.parent, dto(f.child.id, { amountCents: 1_000_000 }), { ip: IP }, NOW)).status).toBe('SUCCEEDED');
    });
  });

  describe('no sensitive data in logs', () => {
    it('card token and customer IP never reach console/stdout/stderr, on success or failure', async () => {
      const spies = [jest.spyOn(console, 'log'), jest.spyOn(console, 'error'), jest.spyOn(console, 'warn'), jest.spyOn(process.stdout, 'write'), jest.spyOn(process.stderr, 'write')].map((s) => s.mockImplementation(() => true as any));
      try {
        const f = await billingFamily('cc-logs');
        await payments.chargeCard(f.parent, dto(f.child.id), { ip: IP }, NOW);
        gateway.charge.mockRejectedValueOnce(new Error('boom'));
        await payments.chargeCard(f.parent, dto(f.child.id), { ip: IP }, NOW).catch(() => undefined);
        const all = spies.flatMap((s) => s.mock.calls.map((c) => JSON.stringify(c))).join('\n');
        expect(all).not.toContain(TOKEN);
        expect(all).not.toContain(IP);
      } finally {
        jest.restoreAllMocks();
      }
    });
  });

  describe('payment_attempts at the database level', () => {
    it('the unique (org_id, idempotency_key) index rejects a duplicate insert', async () => {
      const f = await billingFamily('cc-unique');
      const k = key('dup');
      const row = { orgId: f.tenant.orgId, centreId: f.tenant.centreId, childId: f.child.id, actorUserId: f.parent.userId, idempotencyKey: k, status: 'PENDING', provider: 'MOCK', amountCents: 100 };
      await db.paymentAttempt.create({ data: row });
      await expect(db.paymentAttempt.create({ data: row })).rejects.toThrow();
    });
  });
});
