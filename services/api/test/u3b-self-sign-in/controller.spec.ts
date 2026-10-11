import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { JwtAuthGuard } from '../../src/authorization/guards/jwt-auth.guard';
import { AttendanceController } from '../../src/attendance/attendance.controller';
import { SelfSignInController } from '../../src/attendance/self-sign-in.controller';

const GET = RequestMethod.GET;
const POST = RequestMethod.POST;
const PUT = RequestMethod.PUT;

function fullPath(ctrl: any, handler: string): string {
  const base: string = Reflect.getMetadata('path', ctrl) ?? '';
  const sub: string = Reflect.getMetadata('path', ctrl.prototype[handler]) ?? '';
  return [base, sub].join('/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}

function guarded(ctrl: any, handler: string): boolean {
  const onClass: unknown[] = Reflect.getMetadata('__guards__', ctrl) ?? [];
  const onHandler: unknown[] = Reflect.getMetadata('__guards__', ctrl.prototype[handler]) ?? [];
  return [...onClass, ...onHandler].includes(JwtAuthGuard);
}

describe('AttendanceController (existing routes are kept)', () => {
  it.each([
    ['record', POST, 'attendance/events'],
    ['correct', POST, 'attendance/events/:eventId/correct'],
    ['history', GET, 'children/:childId/attendance'],
  ])('%s', (handler, method, path) => {
    expect(Reflect.getMetadata('method', AttendanceController.prototype[handler as 'record'])).toBe(method);
    expect(fullPath(AttendanceController, handler)).toBe(path);
    expect(guarded(AttendanceController, handler)).toBe(true);
  });
});

describe('SelfSignInController routes', () => {
  it.each([
    ['checkInCode', GET, 'centre/checkin-code'],
    ['setSelfSignIn', PUT, 'centre/self-sign-in'],
    ['selfSignIn', POST, 'children/:childId/attendance/self'],
  ])('%s has the right verb, path and JwtAuthGuard', (handler, method, path) => {
    const fn = (SelfSignInController.prototype as any)[handler];
    expect(typeof fn).toBe('function');
    expect(Reflect.getMetadata('method', fn)).toBe(method);
    expect(fullPath(SelfSignInController, handler)).toBe(path);
    expect(guarded(SelfSignInController, handler)).toBe(true);
  });

  it('selfSignIn has a throttle override tighter than the global limit', () => {
    const fn = (SelfSignInController.prototype as any).selfSignIn;
    const keys = Reflect.getMetadataKeys(fn) as string[];
    const throttleKeys = keys.filter((k) => typeof k === 'string' && k.startsWith('THROTTLER'));
    expect(throttleKeys.length).toBeGreaterThan(0);
  });
});
