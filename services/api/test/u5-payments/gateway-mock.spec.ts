import { MockPaymentGateway } from '../../src/billing/gateway/mock-payment.gateway';
import { PaymentGatewayError } from '../../src/billing/gateway/payment-gateway.interface';

describe('PaymentGateway interface + MockPaymentGateway', () => {
  const gw = new MockPaymentGateway();
  const base = { amountCents: 1000, reference: 'ref-1', customerIp: '1.2.3.4' };

  it('is the MOCK provider', () => expect(gw.provider).toBe('MOCK'));

  it('succeeds deterministically with providerPaymentId mock_<reference>', async () => {
    const r = await gw.charge({ ...base, cardToken: 'tok_ok' });
    expect(r).toMatchObject({ status: 'SUCCEEDED', providerPaymentId: 'mock_ref-1' });
    expect(await gw.charge({ ...base, cardToken: 'tok_ok' })).toEqual(r);
  });

  it('tok_fail* tokens are declined', async () => {
    const r = await gw.charge({ ...base, cardToken: 'tok_fail_insufficient' });
    expect(r.status).toBe('FAILED');
    expect(r.message).toBe('Declined');
  });

  it('tok_throw throws', async () => {
    await expect(gw.charge({ ...base, cardToken: 'tok_throw' })).rejects.toThrow();
  });

  it('verifyWebhook is true only for x-mock-signature: valid', () => {
    expect(gw.verifyWebhook('{}', { 'x-mock-signature': 'valid' })).toBe(true);
    expect(gw.verifyWebhook('{}', { 'x-mock-signature': 'nope' })).toBe(false);
    expect(gw.verifyWebhook('{}', {})).toBe(false);
  });

  it('PaymentGatewayError is an Error', () => {
    expect(new PaymentGatewayError('x')).toBeInstanceOf(Error);
  });
});
