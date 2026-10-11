import { createHash, timingSafeEqual } from 'crypto';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(src).sort().map((k) => [k, canonical(src[k])]));
  }
  return value;
}

/** SHA-256 (lowercase hex) of the answers as JSON with object keys sorted recursively; array order is kept. */
export function computeAnswersHash(answers: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(answers))).digest('hex');
}

export function verifyAnswersHash(answers: unknown, hash: string): boolean {
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) return false;
  return timingSafeEqual(Buffer.from(computeAnswersHash(answers)), Buffer.from(hash));
}
