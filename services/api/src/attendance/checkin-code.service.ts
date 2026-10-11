import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';

const WINDOW_MS = 60_000;

/**
 * Rotating 6-digit code that proves a parent is physically at the centre (PAR-015).
 * Derived from a secret and the centre id, so nothing is stored; staff see the same value the API checks.
 * The previous minute's code is also accepted so a code typed as the minute rolls over still works.
 */
@Injectable()
export class CheckInCodeService {
  codeFor(centreId: string, now: Date = new Date()): { code: string; validForSeconds: number } {
    const ms = now.getTime();
    const window = Math.floor(ms / WINDOW_MS);
    return { code: this.codeForWindow(centreId, window), validForSeconds: Math.ceil(((window + 1) * WINDOW_MS - ms) / 1000) };
  }

  isValid(centreId: string, code: string, now: Date = new Date()): boolean {
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return false;
    const window = Math.floor(now.getTime() / WINDOW_MS);
    const given = Buffer.from(code);
    // Evaluate both windows without short-circuiting so timing does not reveal which one matched.
    const current = timingSafeEqual(given, Buffer.from(this.codeForWindow(centreId, window)));
    const previous = timingSafeEqual(given, Buffer.from(this.codeForWindow(centreId, window - 1)));
    return current || previous;
  }

  private codeForWindow(centreId: string, window: number): string {
    const secret = process.env.CHECKIN_CODE_SECRET || process.env.JWT_SECRET;
    if (!secret) throw new Error('CHECKIN_CODE_SECRET or JWT_SECRET must be set');
    const digest = createHmac('sha256', secret).update(`checkin:${centreId}:${window}`).digest();
    return (digest.readUInt32BE(0) % 1_000_000).toString().padStart(6, '0');
  }
}
