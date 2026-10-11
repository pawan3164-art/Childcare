import { newIdempotencyKey, payOption, resultMessage } from '../lib/pay';

describe('payOption', () => {
  it('offers a demo payment of the amount due only while the gateway is the mock', () => {
    expect(payOption({ provider: 'MOCK', mode: 'mock' }, 12345)).toEqual({ kind: 'demo', amountCents: 12345, label: 'Pay $123.45 (demo, no real money)' });
  });

  it('offers nothing when nothing is due or the account is in credit', () => {
    expect(payOption({ provider: 'MOCK', mode: 'mock' }, 0)).toBeNull();
    expect(payOption({ provider: 'MOCK', mode: 'mock' }, -500)).toBeNull();
  });

  it('offers nothing in live mode until the hosted card fields are built', () => {
    expect(payOption({ provider: 'FAT_ZEBRA', mode: 'live' }, 5000)).toBeNull();
  });

  it('offers nothing when the config is not known', () => {
    expect(payOption(null, 5000)).toBeNull();
  });

  it('caps one payment at the server limit of $10,000', () => {
    expect(payOption({ provider: 'MOCK', mode: 'mock' }, 5_000_000)?.amountCents).toBe(1_000_000);
  });
});

describe('newIdempotencyKey', () => {
  it('is 8 to 100 characters of letters, digits, dashes and underscores, and differs each time', () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
    expect(a).not.toBe(b);
  });
});

describe('resultMessage', () => {
  it('thanks the parent on success and shows the card used', () => {
    expect(resultMessage({ status: 'SUCCEEDED', paymentId: 'p', amountCents: 5000, card: { brand: 'VISA', last4: '4242' } })).toBe('Payment of $50.00 received (VISA ending 4242).');
    expect(resultMessage({ status: 'SUCCEEDED', paymentId: 'p', amountCents: 5000 })).toBe('Payment of $50.00 received.');
  });

  it('says the payment was declined, with the reason, and that nothing was charged', () => {
    expect(resultMessage({ status: 'FAILED', paymentId: null, amountCents: 5000, message: 'Declined' })).toBe('The payment was declined (Declined). Nothing was charged.');
  });
});
