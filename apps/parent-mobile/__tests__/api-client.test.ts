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
