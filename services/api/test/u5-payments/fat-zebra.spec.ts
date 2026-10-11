import { createHmac } from 'crypto';
import { FatZebraGateway } from '../../src/billing/gateway/fat-zebra.gateway';
import { PaymentGatewayError } from '../../src/billing/gateway/payment-gateway.interface';

/**
 * FIXTURES COME FROM FAT ZEBRA'S PUBLISHED DOCUMENTATION, NOT THE REAL SANDBOX.
 * No merchant account exists yet (ADR 0006); the decline payload is plausible, not recorded.
 */
const SUCCESS_FIXTURE = {
  successful: true,
  response: {
    authorization: '468422', id: '071-P-97AG1LA1', card_number: '424242XXXXXX4242', card_token: 'syupxv5b1tqv4bqdsazr',
    card_type: 'VISA', amount: 1000, successful: true, message: 'Approved', reference: 'oiuwiouwxmnx23', currency: 'AUD',
    transaction_id: '071-P-97AG1LA1', response_code: '00', captured: true, captured_amount: 1000,
  },
  errors: [],
  test: true,
};
const DECLINE_FIXTURE = {
  successful: true,
  response: { id: '071-P-97AG1LA2', card_number: '555555XXXXXX4444', card_type: 'MasterCard', amount: 1000, successful: false, message: 'Declined', response_code: '05', reference: 'r', currency: 'AUD' },
  errors: [],
  test: true,
};
const ERROR_FIXTURE = { successful: false, response: {}, errors: ['Card token is invalid'], test: true };

const CFG = { baseUrl: 'https://gateway.pmnts-sandbox.io/v1.0', username: 'TESTuser', token: 'SUPERSECRETTOKEN', webhookSecret: 'whsec_abc' };
const INPUT = { amountCents: 1000, reference: 'oiuwiouwxmnx23', customerIp: '203.0.113.7', cardToken: 'syupxv5b1tqv4bqdsazr' };

const res = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }) as any;

describe('FatZebraGateway.charge (stubbed fetch)', () => {
  it('is the FAT_ZEBRA provider', () => {
    expect(new FatZebraGateway({ ...CFG, fetchImpl: jest.fn() as any }).provider).toBe('FAT_ZEBRA');
  });

  it('POSTs /purchases with Basic auth, JSON body in cents and an abort signal', async () => {
    const fetchImpl = jest.fn(async (..._a: any[]) => res(200, SUCCESS_FIXTURE));
    await new FatZebraGateway({ ...CFG, fetchImpl: fetchImpl as any }).charge(INPUT);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as any[];
    expect(url).toBe(`${CFG.baseUrl}/purchases`);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.headers['Authorization']).toBe(`Basic ${Buffer.from('TESTuser:SUPERSECRETTOKEN').toString('base64')}`);
    expect(JSON.parse(init.body)).toEqual({ amount: 1000, reference: 'oiuwiouwxmnx23', customer_ip: '203.0.113.7', currency: 'AUD', card_token: 'syupxv5b1tqv4bqdsazr' });
    expect(init.signal).toBeDefined();
    expect(init.redirect).toBe('error');
  });

  it('honours an explicit currency', async () => {
    const fetchImpl = jest.fn(async (..._a: any[]) => res(200, SUCCESS_FIXTURE));
    await new FatZebraGateway({ ...CFG, fetchImpl: fetchImpl as any }).charge({ ...INPUT, currency: 'NZD' });
    expect(JSON.parse((fetchImpl.mock.calls[0] as any[])[1].body).currency).toBe('NZD');
  });

  it('maps the documented success payload', async () => {
    const r = await new FatZebraGateway({ ...CFG, fetchImpl: (async () => res(200, SUCCESS_FIXTURE)) as any }).charge(INPUT);
    expect(r).toEqual({ status: 'SUCCEEDED', providerPaymentId: '071-P-97AG1LA1', message: 'Approved', card: { brand: 'VISA', last4: '4242' } });
  });

  it('maps an inner response.successful=false to FAILED with the response message', async () => {
    const r = await new FatZebraGateway({ ...CFG, fetchImpl: (async () => res(200, DECLINE_FIXTURE)) as any }).charge(INPUT);
    expect(r.status).toBe('FAILED');
    expect(r.message).toBe('Declined');
  });

  it('maps top-level successful=false to FAILED using errors[0]', async () => {
    const r = await new FatZebraGateway({ ...CFG, fetchImpl: (async () => res(200, ERROR_FIXTURE)) as any }).charge(INPUT);
    expect(r.status).toBe('FAILED');
    expect(r.message).toBe('Card token is invalid');
  });

  it.each([400, 401, 422, 500, 503])('HTTP %i throws PaymentGatewayError without leaking secrets', async (code) => {
    const gw = new FatZebraGateway({ ...CFG, fetchImpl: (async () => res(code, { errors: ['boom'] })) as any });
    const err = await gw.charge(INPUT).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentGatewayError);
    const text = `${err.message} ${err.stack ?? ''}`;
    for (const secret of ['SUPERSECRETTOKEN', 'TESTuser', INPUT.cardToken, 'whsec_abc']) expect(text).not.toContain(secret);
  });

  it('network errors throw PaymentGatewayError and never include the token or credentials', async () => {
    const gw = new FatZebraGateway({ ...CFG, fetchImpl: (async () => { throw new Error(`connect ECONNRESET ${INPUT.cardToken} SUPERSECRETTOKEN`); }) as any });
    const err = await gw.charge(INPUT).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentGatewayError);
    expect(err.message).not.toContain('SUPERSECRETTOKEN');
    expect(err.message).not.toContain(INPUT.cardToken);
  });

  it('times out after 10s via AbortController', async () => {
    jest.useFakeTimers();
    try {
      const fetchImpl = jest.fn((_u: string, init: any) => new Promise((_r, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted')))));
      const p = new FatZebraGateway({ ...CFG, fetchImpl: fetchImpl as any }).charge(INPUT).catch((e) => e);
      await jest.advanceTimersByTimeAsync(10_001);
      expect(await p).toBeInstanceOf(PaymentGatewayError);
    } finally {
      jest.useRealTimers();
    }
  });

  it('never logs the token or credentials', async () => {
    const spies = [jest.spyOn(console, 'log'), jest.spyOn(console, 'error'), jest.spyOn(console, 'warn'), jest.spyOn(process.stdout, 'write')].map((s) => s.mockImplementation(() => true as any));
    try {
      await new FatZebraGateway({ ...CFG, fetchImpl: (async () => res(200, SUCCESS_FIXTURE)) as any }).charge(INPUT);
      await new FatZebraGateway({ ...CFG, fetchImpl: (async () => res(500, {})) as any }).charge(INPUT).catch(() => undefined);
      const all = spies.flatMap((s) => s.mock.calls.map((c) => JSON.stringify(c))).join('\n');
      expect(all).not.toContain('SUPERSECRETTOKEN');
      expect(all).not.toContain(INPUT.cardToken);
    } finally {
      jest.restoreAllMocks();
    }
  });
});

describe('FatZebraGateway.verifyWebhook (signing scheme is an assumption, confirm at onboarding)', () => {
  const gw = new FatZebraGateway({ ...CFG, fetchImpl: jest.fn() as any });
  const body = '{"id":"071-P-97AG1LA1"}';
  const sig = createHmac('sha256', CFG.webhookSecret).update(body).digest('hex');

  it('accepts the HMAC-SHA256 hex of the raw body', () => expect(gw.verifyWebhook(body, { 'x-fz-signature': sig })).toBe(true));
  it('rejects a wrong value of the right length', () => expect(gw.verifyWebhook(body, { 'x-fz-signature': 'a'.repeat(64) })).toBe(false));
  it('rejects a wrong length without throwing', () => expect(gw.verifyWebhook(body, { 'x-fz-signature': 'abc' })).toBe(false));
  it('rejects a tampered body', () => expect(gw.verifyWebhook(body + ' ', { 'x-fz-signature': sig })).toBe(false));
  it('rejects a missing header', () => expect(gw.verifyWebhook(body, {})).toBe(false));
  it('rejects when the secret is missing', () => {
    const noSecret = new FatZebraGateway({ ...CFG, webhookSecret: '', fetchImpl: jest.fn() as any });
    expect(noSecret.verifyWebhook(body, { 'x-fz-signature': createHmac('sha256', '').update(body).digest('hex') })).toBe(false);
  });
});
