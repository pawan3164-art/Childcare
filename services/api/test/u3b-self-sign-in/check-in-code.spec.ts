import { CheckInCodeService } from '../../src/attendance/checkin-code.service';

const W = 60_000;
const BASE = Math.floor(new Date('2026-10-13T20:00:00Z').getTime() / W) * W; // aligned window start

describe('CheckInCodeService', () => {
  const savedCheckin = process.env.CHECKIN_CODE_SECRET;
  const savedJwt = process.env.JWT_SECRET;
  let svc: CheckInCodeService;

  beforeEach(() => {
    process.env.CHECKIN_CODE_SECRET = 'secret-one';
    svc = new CheckInCodeService();
  });
  afterAll(() => {
    if (savedCheckin === undefined) delete process.env.CHECKIN_CODE_SECRET;
    else process.env.CHECKIN_CODE_SECRET = savedCheckin;
    if (savedJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = savedJwt;
  });

  it('returns exactly 6 digits as a string', () => {
    for (let i = 0; i < 50; i++) {
      const { code } = svc.codeFor(`centre-${i}`, new Date(BASE + i * W));
      expect(typeof code).toBe('string');
      expect(code).toMatch(/^\d{6}$/);
    }
  });

  it('is deterministic within a 60s window and changes in the next', () => {
    const a = svc.codeFor('c1', new Date(BASE + 1));
    const b = svc.codeFor('c1', new Date(BASE + 59_999));
    const c = svc.codeFor('c1', new Date(BASE + W));
    expect(a.code).toBe(b.code);
    expect(c.code).not.toBe(a.code);
  });

  it('validForSeconds is the whole seconds left in the window (1..60)', () => {
    expect(svc.codeFor('c1', new Date(BASE)).validForSeconds).toBe(60);
    expect(svc.codeFor('c1', new Date(BASE + 1_000)).validForSeconds).toBe(59);
    expect(svc.codeFor('c1', new Date(BASE + 30_500)).validForSeconds).toBe(30);
    expect(svc.codeFor('c1', new Date(BASE + 59_999)).validForSeconds).toBe(1);
  });

  it('different centres differ in the same window (>=19 of 20 windows)', () => {
    let differing = 0;
    for (let i = 0; i < 20; i++) {
      const t = new Date(BASE + i * W);
      if (svc.codeFor('centre-A', t).code !== svc.codeFor('centre-B', t).code) differing++;
    }
    expect(differing).toBeGreaterThanOrEqual(19);
  });

  it('reads the key at call time and different secrets give different codes', () => {
    const series = () => Array.from({ length: 10 }, (_, i) => svc.codeFor('c1', new Date(BASE + i * W)).code);
    const one = series();
    process.env.CHECKIN_CODE_SECRET = 'secret-two';
    expect(series()).not.toEqual(one);
  });

  it('derives the key from JWT_SECRET when CHECKIN_CODE_SECRET is unset', () => {
    delete process.env.CHECKIN_CODE_SECRET;
    const series = (s: string) => {
      process.env.JWT_SECRET = s;
      return Array.from({ length: 10 }, (_, i) => svc.codeFor('c1', new Date(BASE + i * W)).code);
    };
    const a = series('jwt-secret-a');
    expect(a.every((c) => /^\d{6}$/.test(c))).toBe(true);
    expect(series('jwt-secret-a')).toEqual(a);
    expect(series('jwt-secret-b')).not.toEqual(a);
  });

  it('fails closed when neither secret is set', () => {
    delete process.env.CHECKIN_CODE_SECRET;
    delete process.env.JWT_SECRET;
    expect(() => svc.codeFor('c1', new Date(BASE))).toThrow(Error);
    expect(() => svc.isValid('c1', '123456', new Date(BASE))).toThrow(Error);
  });

  describe('isValid', () => {
    const at = (n: number) => new Date(BASE + n * W);
    const code = (centre: string, n: number) => svc.codeFor(centre, at(n)).code;
    const now = () => new Date(BASE + 10_000);

    it('accepts the current and previous window', () => {
      expect(svc.isValid('c1', code('c1', 0), now())).toBe(true);
      expect(svc.isValid('c1', code('c1', -1), now())).toBe(true);
    });

    it('rejects two windows back, and a future window', () => {
      const cur = code('c1', 0);
      const prev = code('c1', -1);
      const old = code('c1', -2);
      const future = code('c1', 1);
      // A 6-digit code can collide across windows (1 in 10^6); skip only in that case.
      if (old !== cur && old !== prev) expect(svc.isValid('c1', old, now())).toBe(false);
      if (future !== cur && future !== prev) expect(svc.isValid('c1', future, now())).toBe(false);
    });

    it('rejects another centre code', () => {
      const other = code('c2', 0);
      if (other !== code('c1', 0) && other !== code('c1', -1)) {
        expect(svc.isValid('c1', other, now())).toBe(false);
      }
    });

    it.each([
      ['letters', 'abcdef'],
      ['leading space', ' 12345'],
      ['5 digits', '12345'],
      ['7 digits', '1234567'],
      ['empty', ''],
      ['padded with whitespace', ' 123456 '],
    ])('rejects malformed input: %s', (_label, bad) => {
      expect(svc.isValid('c1', bad, now())).toBe(false);
    });

    it('rejects a valid code with extra characters appended', () => {
      const c = code('c1', 0);
      expect(svc.isValid('c1', `${c}0`, now())).toBe(false);
      expect(svc.isValid('c1', `${c}x`, now())).toBe(false);
    });

    it('rejects non-string input', () => {
      for (const bad of [123456, null, undefined, {}, ['123456']]) {
        expect(svc.isValid('c1', bad as unknown as string, now())).toBe(false);
      }
    });

    it('accepts a code typed just as the minute rolls over', () => {
      expect(svc.isValid('c1', code('c1', 0), new Date(BASE + W + 500))).toBe(true);
    });
  });
});
