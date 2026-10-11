import { createRefresher } from '@/lib/auth-refresh';

const json = (status: number, body?: unknown) => new Response(body === undefined ? '' : JSON.stringify(body), { status });

function setup(over: { token?: string | null; fetchImpl?: jest.Mock; onTokens?: jest.Mock } = {}) {
  const fetchImpl = over.fetchImpl ?? jest.fn(async () => json(200, { mfaRequired: false, accessToken: 'A2', refreshToken: 'R2', expiresIn: 900 }));
  const onTokens = over.onTokens ?? jest.fn();
  const refresh = createRefresher({
    baseUrl: 'https://api.test',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    getRefreshToken: () => (over.token === undefined ? 'R1' : over.token),
    onTokens,
  });
  return { refresh, fetchImpl, onTokens };
}
const hdr = (init: any, name: string) => {
  const h = init?.headers ?? {};
  if (typeof h.get === 'function') return h.get(name) ?? undefined;
  const k = Object.keys(h).find((x) => x.toLowerCase() === name.toLowerCase());
  return k ? h[k] : undefined;
};

describe('createRefresher', () => {
  it('POSTs the refresh token as JSON to /auth/refresh without Authorization', async () => {
    const { refresh, fetchImpl } = setup();
    await refresh();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/auth/refresh');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ refreshToken: 'R1' });
    expect(hdr(init, 'Content-Type')).toBe('application/json');
    expect(hdr(init, 'Authorization')).toBeUndefined();
  });
  it('200 with both tokens: onTokens once with the new pair, returns ok', async () => {
    const { refresh, onTokens } = setup();
    await expect(refresh()).resolves.toBe('ok');
    expect(onTokens).toHaveBeenCalledTimes(1);
    expect(onTokens).toHaveBeenCalledWith({ accessToken: 'A2', refreshToken: 'R2' });
  });
  it('awaits an async onTokens before resolving ok', async () => {
    let done = false;
    const { refresh } = setup({
      onTokens: jest.fn(async () => {
        await new Promise((r) => setTimeout(r, 10));
        done = true;
      }),
    });
    await refresh();
    expect(done).toBe(true);
  });
  it('no refresh token held: rejected and no fetch', async () => {
    const { refresh, fetchImpl, onTokens } = setup({ token: null });
    await expect(refresh()).resolves.toBe('rejected');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(onTokens).not.toHaveBeenCalled();
  });
  it.each([401, 400])('HTTP %i is rejected', async (status) => {
    const { refresh, onTokens } = setup({ fetchImpl: jest.fn(async () => json(status, { message: 'x' })) });
    await expect(refresh()).resolves.toBe('rejected');
    expect(onTokens).not.toHaveBeenCalled();
  });
  it.each([500, 502, 503, 429])('HTTP %i is unavailable', async (status) => {
    const { refresh, onTokens } = setup({ fetchImpl: jest.fn(async () => json(status, {})) });
    await expect(refresh()).resolves.toBe('unavailable');
    expect(onTokens).not.toHaveBeenCalled();
  });
  it('network failure is unavailable', async () => {
    const { refresh, onTokens } = setup({
      fetchImpl: jest.fn(async () => {
        throw new TypeError('Network request failed');
      }),
    });
    await expect(refresh()).resolves.toBe('unavailable');
    expect(onTokens).not.toHaveBeenCalled();
  });
  it.each([
    ['no accessToken', { refreshToken: 'R2' }],
    ['no refreshToken', { accessToken: 'A2' }],
    ['empty body object', {}],
  ])('200 with %s is rejected', async (_n, body) => {
    const { refresh, onTokens } = setup({ fetchImpl: jest.fn(async () => json(200, body)) });
    await expect(refresh()).resolves.toBe('rejected');
    expect(onTokens).not.toHaveBeenCalled();
  });
  it('onTokens rejecting yields unavailable (never sign out on half-written state)', async () => {
    const { refresh } = setup({
      onTokens: jest.fn(async () => {
        throw new Error('disk full');
      }),
    });
    await expect(refresh()).resolves.toBe('unavailable');
  });
  it('onTokens throwing synchronously also yields unavailable', async () => {
    const { refresh } = setup({
      onTokens: jest.fn(() => {
        throw new Error('boom');
      }),
    });
    await expect(refresh()).resolves.toBe('unavailable');
  });
  it('reads the refresh token fresh on each call and does not de-duplicate', async () => {
    let tok = 'R1';
    const fetchImpl = jest.fn(async () => json(200, { accessToken: 'a', refreshToken: 'b' }));
    const refresh = createRefresher({
      baseUrl: 'https://api.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getRefreshToken: () => tok,
      onTokens: () => {
        tok = 'R9';
      },
    });
    await Promise.all([refresh(), refresh()]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await refresh();
    expect(JSON.parse((fetchImpl.mock.calls[2] as any)[1].body)).toEqual({ refreshToken: 'R9' });
  });
});
