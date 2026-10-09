import { decodeJwtExpiry, isTokenExpired, createSessionStore } from '@/lib/session';

const b64url = (o: unknown) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
const jwt = (payload: unknown) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.sig`;

describe('decodeJwtExpiry', () => {
  it('reads exp in seconds', () => expect(decodeJwtExpiry(jwt({ exp: 1800000000 }))).toBe(1800000000));
  it('handles base64url characters in payload', () => {
    expect(decodeJwtExpiry(jwt({ exp: 1800000000, name: '???>>>~~~' }))).toBe(1800000000);
  });
  it('null when exp missing', () => expect(decodeJwtExpiry(jwt({ sub: 'u' }))).toBeNull());
  it('null when exp is not a number', () => expect(decodeJwtExpiry(jwt({ exp: 'soon' }))).toBeNull());
  it('null for garbage', () => {
    expect(decodeJwtExpiry('')).toBeNull();
    expect(decodeJwtExpiry('not-a-jwt')).toBeNull();
    expect(decodeJwtExpiry('a.b')).toBeNull();
  });
  it('null when payload is not JSON', () => expect(decodeJwtExpiry(`h.${b64url('{nope')}.s`)).toBeNull());
});

describe('isTokenExpired', () => {
  const nowMs = 1_000_000_000_000; // exp seconds = 1e9
  it('false when well in the future', () => expect(isTokenExpired(jwt({ exp: 1_000_000_600 }), nowMs)).toBe(false));
  it('true when in the past', () => expect(isTokenExpired(jwt({ exp: 999_999_000 }), nowMs)).toBe(true));
  it('true within the default 30s skew', () => expect(isTokenExpired(jwt({ exp: 1_000_000_020 }), nowMs)).toBe(true));
  it('true exactly at the skew boundary (exp - skew <= now)', () => expect(isTokenExpired(jwt({ exp: 1_000_000_030 }), nowMs)).toBe(true));
  it('false one second past the skew boundary', () => expect(isTokenExpired(jwt({ exp: 1_000_000_031 }), nowMs)).toBe(false));
  it('respects a custom skew', () => {
    expect(isTokenExpired(jwt({ exp: 1_000_000_020 }), nowMs, 0)).toBe(false);
    expect(isTokenExpired(jwt({ exp: 1_000_000_020 }), nowMs, 60)).toBe(true);
  });
  it('true for malformed tokens or missing exp', () => {
    expect(isTokenExpired('junk', nowMs)).toBe(true);
    expect(isTokenExpired(jwt({}), nowMs)).toBe(true);
  });
});

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: jest.fn(async (k: string) => (k in data ? data[k] : null)),
    setItem: jest.fn(async (k: string, v: string) => { data[k] = v; }),
    removeItem: jest.fn(async (k: string) => { delete data[k]; }),
  };
}

describe('createSessionStore', () => {
  const nowMs = 1_000_000_000_000;
  const good = jwt({ exp: 1_000_003_600 });
  const expired = jwt({ exp: 999_990_000 });

  it('load returns null when nothing stored', async () => {
    expect(await createSessionStore(memoryStorage()).load(nowMs)).toBeNull();
  });
  it('save then load round-trips a valid token', async () => {
    const store = createSessionStore(memoryStorage());
    await store.save(good);
    expect(await store.load(nowMs)).toBe(good);
  });
  it('expired stored token is removed and null returned', async () => {
    const storage = memoryStorage();
    const store = createSessionStore(storage);
    await store.save(expired);
    expect(await store.load(nowMs)).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledTimes(1);
    expect(Object.keys(storage.data)).toHaveLength(0);
  });
  it('malformed stored token is removed and null returned', async () => {
    const storage = memoryStorage();
    const store = createSessionStore(storage);
    await store.save('garbage');
    expect(await store.load(nowMs)).toBeNull();
    expect(Object.keys(storage.data)).toHaveLength(0);
  });
  it('clear removes the token', async () => {
    const storage = memoryStorage();
    const store = createSessionStore(storage);
    await store.save(good);
    await store.clear();
    expect(await store.load(nowMs)).toBeNull();
  });
  it('storage errors never throw', async () => {
    const boom = {
      getItem: jest.fn().mockRejectedValue(new Error('x')),
      setItem: jest.fn().mockRejectedValue(new Error('x')),
      removeItem: jest.fn().mockRejectedValue(new Error('x')),
    };
    const store = createSessionStore(boom);
    await expect(store.load(nowMs)).resolves.toBeNull();
    await expect(store.save(good)).resolves.toBeUndefined();
    await expect(store.clear()).resolves.toBeUndefined();
  });
  it('load swallows a removeItem failure for an expired token', async () => {
    const storage = memoryStorage();
    const store = createSessionStore(storage);
    await store.save(expired);
    storage.removeItem.mockRejectedValueOnce(new Error('x'));
    await expect(store.load(nowMs)).resolves.toBeNull();
  });
});
