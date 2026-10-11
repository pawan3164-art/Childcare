import 'reflect-metadata';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ModuleGuard, REQUIRES_MODULE_KEY, RequiresModule } from '../../src/features/module.guard';

@RequiresModule('learning')
class ClassLevel {
  inherits() {}
  @RequiresModule('billing')
  overrides() {}
}

class NoMetadata {
  plain() {}
}

class MethodOnly {
  @RequiresModule('checklists')
  guarded() {}
  open() {}
}

function ctx(cls: any, method: string, user: any, hasUser = true): ExecutionContext {
  return {
    getHandler: () => cls.prototype[method],
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => (hasUser ? { user } : {}) }),
  } as any;
}

describe('C0 ModuleGuard and RequiresModule', () => {
  const user = { userId: 'u', orgId: 'org-1', centreId: 'c-1', role: 'PARENT', sessionId: 's' };
  let calls: Array<[string, string, string]>;
  let enabled: Record<string, boolean>;
  const features: any = {
    isEnabled: jest.fn(async (orgId: string, centreId: string, key: string) => {
      calls.push([orgId, centreId, key]);
      return enabled[key] ?? false;
    }),
  };
  const guard = new ModuleGuard(new Reflector(), features);

  beforeEach(() => {
    calls = [];
    enabled = {};
    features.isEnabled.mockClear();
  });

  it('REQUIRES_MODULE_KEY is exported and holds the key on the class or method', () => {
    expect(typeof REQUIRES_MODULE_KEY).toBe('string');
    expect(Reflect.getMetadata(REQUIRES_MODULE_KEY, ClassLevel)).toBe('learning');
    expect(Reflect.getMetadata(REQUIRES_MODULE_KEY, ClassLevel.prototype.overrides)).toBe('billing');
    expect(Reflect.getMetadata(REQUIRES_MODULE_KEY, MethodOnly.prototype.guarded)).toBe('checklists');
  });

  it('no metadata passes without consulting features', async () => {
    await expect(guard.canActivate(ctx(NoMetadata, 'plain', user))).resolves.toBe(true);
    expect(features.isEnabled).not.toHaveBeenCalled();
  });

  it('a method without metadata on a class without metadata passes', async () => {
    await expect(guard.canActivate(ctx(MethodOnly, 'open', user))).resolves.toBe(true);
    expect(features.isEnabled).not.toHaveBeenCalled();
  });

  it('enabled module passes, checked for the request user org and centre', async () => {
    enabled.learning = true;
    await expect(guard.canActivate(ctx(ClassLevel, 'inherits', user))).resolves.toBe(true);
    expect(calls).toEqual([['org-1', 'c-1', 'learning']]);
  });

  it('disabled module is Forbidden with a message naming the module label and the centre', async () => {
    enabled.learning = false;
    const err = await Promise.resolve(guard.canActivate(ctx(ClassLevel, 'inherits', user))).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.message).toBe('Learning is switched off for your centre');
  });

  it('uses the registry label for the message (billing)', async () => {
    const err = await Promise.resolve(guard.canActivate(ctx(ClassLevel, 'overrides', user))).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.message).toMatch(/^Billing and CCS is switched off for your centre/);
  });

  it('method-level metadata overrides class-level', async () => {
    enabled.learning = false;
    enabled.billing = true;
    await expect(guard.canActivate(ctx(ClassLevel, 'overrides', user))).resolves.toBe(true);
    expect(calls).toEqual([['org-1', 'c-1', 'billing']]);
  });

  it('method-only metadata is enforced', async () => {
    const err = await Promise.resolve(guard.canActivate(ctx(MethodOnly, 'guarded', user))).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.message).toMatch(/^Room checklists is switched off/);
  });

  it('no request.user passes (authentication is the JwtAuthGuard job)', async () => {
    await expect(guard.canActivate(ctx(ClassLevel, 'inherits', undefined, false))).resolves.toBe(true);
    expect(features.isEnabled).not.toHaveBeenCalled();
  });

  it('a user with no orgId is Forbidden', async () => {
    const err = await Promise.resolve(guard.canActivate(ctx(ClassLevel, 'inherits', { ...user, orgId: null }))).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(features.isEnabled).not.toHaveBeenCalled();
  });

  it('checks with real time (no now argument or a current Date)', async () => {
    enabled.learning = true;
    await guard.canActivate(ctx(ClassLevel, 'inherits', user));
    const args = features.isEnabled.mock.calls[0];
    expect(args.slice(0, 3)).toEqual(['org-1', 'c-1', 'learning']);
    if (args[3] !== undefined) expect(Math.abs((args[3] as Date).getTime() - Date.now())).toBeLessThan(5000);
  });
});
