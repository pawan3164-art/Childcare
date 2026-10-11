import { createApiClient, ApiError } from '@/lib/api-client';

function res(status: number, body?: unknown, statusText = ''): Response {
  const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(status === 204 ? null : text, { status, statusText });
}

function setup(response: Response, token: string | null = 'tok') {
  const fetchImpl = jest.fn(async (..._args: unknown[]) => response);
  const onUnauthorized = jest.fn();
  const client = createApiClient({
    baseUrl: 'https://api.test',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    getToken: () => token,
    onUnauthorized,
  });
  return { client, fetchImpl, onUnauthorized };
}
const callArgs = (f: jest.Mock) => f.mock.calls[0] as unknown as [string, RequestInit];
const header = (init: RequestInit, name: string): string | undefined => {
  const h = init.headers as Headers | Record<string, string> | undefined;
  if (!h) return undefined;
  if (typeof (h as Headers).get === 'function') return (h as Headers).get(name) ?? undefined;
  const key = Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? (h as Record<string, string>)[key] : undefined;
};

describe('createApiClient requests', () => {
  it('GET uses baseUrl+path and parses JSON', async () => {
    const { client, fetchImpl } = setup(res(200, { a: 1 }));
    await expect(client.get('/children')).resolves.toEqual({ a: 1 });
    const [url, init] = callArgs(fetchImpl);
    expect(url).toBe('https://api.test/children');
    expect((init.method ?? 'GET').toUpperCase()).toBe('GET');
  });
  it('sends bearer token when present', async () => {
    const { client, fetchImpl } = setup(res(200, {}));
    await client.get('/x');
    expect(header(callArgs(fetchImpl)[1], 'Authorization')).toBe('Bearer tok');
  });
  it('omits Authorization when no token', async () => {
    const { client, fetchImpl } = setup(res(200, {}), null);
    await client.get('/x');
    expect(header(callArgs(fetchImpl)[1], 'Authorization')).toBeUndefined();
  });
  it('POST sends JSON body and content type', async () => {
    const { client, fetchImpl } = setup(res(201, { id: '1' }));
    await expect(client.post('/auth/login', { email: 'a' })).resolves.toEqual({ id: '1' });
    const [, init] = callArgs(fetchImpl);
    expect(init.method).toBe('POST');
    expect(header(init, 'Content-Type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ email: 'a' });
  });
  it('POST without data works', async () => {
    const { client, fetchImpl } = setup(res(200, {}));
    await client.post('/x');
    expect(callArgs(fetchImpl)[1].method).toBe('POST');
  });
  it('upload sends FormData without a Content-Type header', async () => {
    const { client, fetchImpl } = setup(res(200, { ok: true }));
    const form = new FormData();
    form.append('a', 'b');
    await expect(client.upload('/media', form)).resolves.toEqual({ ok: true });
    const [url, init] = callArgs(fetchImpl);
    expect(url).toBe('https://api.test/media');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(form);
    expect(header(init, 'Content-Type')).toBeUndefined();
    expect(header(init, 'Authorization')).toBe('Bearer tok');
  });
  it('204 resolves undefined', async () => {
    const { client } = setup(res(204));
    await expect(client.post('/x')).resolves.toBeUndefined();
  });
  it('empty 200 body is OK', async () => {
    const { client } = setup(res(200, ''));
    await expect(client.get('/x')).resolves.toBeUndefined();
  });
});

describe('createApiClient errors', () => {
  it('throws ApiError with message from body and status', async () => {
    const { client } = setup(res(400, { message: 'Bad thing' }, 'Bad Request'));
    const err = await client.get('/x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Bad thing');
    expect(err.status).toBe(400);
  });
  it('joins array messages with ", "', async () => {
    const { client } = setup(res(422, { message: ['a is required', 'b is invalid'] }));
    await expect(client.post('/x', {})).rejects.toMatchObject({ message: 'a is required, b is invalid', status: 422 });
  });
  it('falls back to statusText when body is not JSON', async () => {
    const { client } = setup(res(500, 'oops<html>', 'Internal Server Error'));
    await expect(client.get('/x')).rejects.toMatchObject({ message: 'Internal Server Error', status: 500 });
  });
  it('falls back to statusText when body has no message', async () => {
    const { client } = setup(res(404, {}, 'Not Found'));
    await expect(client.get('/x')).rejects.toMatchObject({ message: 'Not Found', status: 404 });
  });
  it('upload errors are ApiErrors too', async () => {
    const { client } = setup(res(413, { message: 'Too big' }));
    await expect(client.upload('/media', new FormData())).rejects.toMatchObject({ message: 'Too big', status: 413 });
  });
});

describe('createApiClient 401 handling', () => {
  it('calls onUnauthorized once then throws', async () => {
    const { client, onUnauthorized } = setup(res(401, { message: 'Unauthorized' }));
    await expect(client.get('/children')).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
  it('also applies to post and upload', async () => {
    const a = setup(res(401, { message: 'u' }));
    await expect(a.client.post('/x', {})).rejects.toBeInstanceOf(ApiError);
    expect(a.onUnauthorized).toHaveBeenCalledTimes(1);
    const b = setup(res(401, { message: 'u' }));
    await expect(b.client.upload('/x', new FormData())).rejects.toBeInstanceOf(ApiError);
    expect(b.onUnauthorized).toHaveBeenCalledTimes(1);
  });
  it('does NOT call onUnauthorized for /auth/login', async () => {
    const { client, onUnauthorized } = setup(res(401, { message: 'Invalid credentials' }));
    await expect(client.post('/auth/login', { email: 'a', password: 'b' })).rejects.toMatchObject({
      message: 'Invalid credentials',
      status: 401,
    });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
  it('does not call onUnauthorized for other errors', async () => {
    const { client, onUnauthorized } = setup(res(403, { message: 'no' }));
    await expect(client.get('/x')).rejects.toMatchObject({ status: 403 });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
  it('works without an onUnauthorized callback', async () => {
    const client = createApiClient({
      baseUrl: 'https://api.test',
      fetchImpl: (async () => res(401, { message: 'u' })) as unknown as typeof fetch,
      getToken: () => null,
    });
    await expect(client.get('/x')).rejects.toMatchObject({ status: 401 });
  });
});

describe('createApiClient refresh-on-401', () => {
  const ok = (body: unknown = {}) => res(200, body);
  const unauth = () => res(401, { message: 'Unauthorized' });

  function build(
    handler: (url: string, init: RequestInit, n: number) => Response,
    refreshResult: 'ok' | 'rejected' | 'unavailable' = 'ok',
  ) {
    let token = 'old';
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = jest.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return handler(url, init, calls.length);
    });
    const refresh = jest.fn(async () => {
      if (refreshResult === 'ok') token = 'new';
      return refreshResult;
    });
    const onUnauthorized = jest.fn();
    const client = createApiClient({
      baseUrl: 'https://api.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getToken: () => token,
      onUnauthorized,
      refresh,
    });
    return { client, calls, refresh, onUnauthorized, fetchImpl };
  }
  const bearer = (c: { init: RequestInit }) => header(c.init, 'Authorization');
  const newOrUnauth = (_u: string, init: RequestInit) =>
    header(init, 'Authorization') === 'Bearer new' ? ok({ a: 1 }) : unauth();

  it('refreshes then retries once with the new token and returns the result', async () => {
    const { client, calls, refresh, onUnauthorized } = build(newOrUnauth);
    await expect(client.get('/children')).resolves.toEqual({ a: 1 });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
    expect(bearer(calls[0])).toBe('Bearer old');
    expect(bearer(calls[1])).toBe('Bearer new');
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
  it('retry keeps method and JSON body for post', async () => {
    const { client, calls } = build(newOrUnauth);
    await client.post('/x', { a: 1 });
    expect(calls[1].init.method).toBe('POST');
    expect(JSON.parse(calls[1].init.body as string)).toEqual({ a: 1 });
  });
  it('retry of an upload reuses the same FormData', async () => {
    const { client, calls } = build(newOrUnauth);
    const form = new FormData();
    form.append('a', 'b');
    await client.upload('/media', form);
    expect(calls[1].init.body).toBe(form);
    expect(header(calls[1].init, 'Content-Type')).toBeUndefined();
  });
  it('a second 401 after a successful refresh calls onUnauthorized once and throws 401', async () => {
    const { client, refresh, onUnauthorized, calls } = build(() => unauth());
    await expect(client.get('/x')).rejects.toMatchObject({ status: 401 });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
  it('rejected signs out and throws the original 401', async () => {
    const { client, onUnauthorized, calls } = build(() => res(401, { message: 'Session expired' }), 'rejected');
    const err = await client.get('/x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(err.message).toBe('Session expired');
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
  });
  it('unavailable does not sign out and throws status 0', async () => {
    const { client, onUnauthorized, calls } = build(() => unauth(), 'unavailable');
    const err = await client.get('/x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.message).toBe('Could not reach the server, try again');
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });
  it('three parallel 401s share one refresh and all resolve after retry', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let token = 'old';
    const fetchImpl = jest.fn(async (_u: string, init: RequestInit) =>
      header(init, 'Authorization') === 'Bearer new' ? ok({ v: 1 }) : unauth(),
    );
    const refresh = jest.fn(async () => {
      await gate;
      token = 'new';
      return 'ok' as const;
    });
    const onUnauthorized = jest.fn();
    const client = createApiClient({
      baseUrl: 'https://api.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getToken: () => token,
      onUnauthorized,
      refresh,
    });
    const all = Promise.all([client.get('/a'), client.get('/b'), client.get('/c')]);
    await new Promise((r) => setTimeout(r, 20));
    expect(refresh).toHaveBeenCalledTimes(1);
    release();
    await expect(all).resolves.toEqual([{ v: 1 }, { v: 1 }, { v: 1 }]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
  it('parallel requests with a rejected refresh share one refresh call and all fail', async () => {
    const { client, refresh } = build(() => unauth(), 'rejected');
    const results = await Promise.allSettled([client.get('/a'), client.get('/b'), client.get('/c')]);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it('a later request uses the new token and does not refresh again', async () => {
    const { client, refresh, calls } = build(newOrUnauth);
    await client.get('/a');
    const before = calls.length;
    await client.get('/b');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(before + 1);
    expect(bearer(calls[before])).toBe('Bearer new');
  });
  it('does not refresh for /auth/login', async () => {
    const { client, refresh, onUnauthorized } = build(() => res(401, { message: 'Invalid credentials' }));
    await expect(client.post('/auth/login', {})).rejects.toMatchObject({ status: 401, message: 'Invalid credentials' });
    expect(refresh).not.toHaveBeenCalled();
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
  it('a 401 on /auth/refresh does not recurse', async () => {
    const { client, refresh } = build(() => unauth());
    await expect(client.post('/auth/refresh', { refreshToken: 'x' })).rejects.toMatchObject({ status: 401 });
    expect(refresh).not.toHaveBeenCalled();
  });
  it('non-401 errors do not refresh', async () => {
    const { client, refresh } = build(() => res(403, { message: 'no' }));
    await expect(client.get('/x')).rejects.toMatchObject({ status: 403 });
    expect(refresh).not.toHaveBeenCalled();
  });
});
