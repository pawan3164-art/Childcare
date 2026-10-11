import 'reflect-metadata';
import { JwtAuthGuard } from '../../src/authorization/guards/jwt-auth.guard';
import { BrandingController } from '../../src/branding/branding.controller';

// Nest stores RequestMethod as an enum number: GET 0, POST 1, PUT 2, DELETE 3.
const GET = 0;
const POST = 1;
const PUT = 2;
const DELETE = 3;

const proto: any = BrandingController.prototype;
const handler = (name: string) => proto[name];

function guardsOf(fn: unknown): unknown[] {
  return Reflect.getMetadata('__guards__', fn as object) ?? [];
}

describe('C0 branding: BrandingController routing and guards', () => {
  it('is mounted without any class-level guard (public handlers must stay public)', () => {
    expect(Reflect.getMetadata('__guards__', BrandingController) ?? []).toEqual([]);
  });

  describe.each(['getBrand', 'updateBrand', 'uploadLogo', 'removeLogo', 'listDomains', 'addDomain', 'verifyDomain', 'removeDomain'])(
    'protected handler %s',
    (name) => {
      it('exists and carries JwtAuthGuard', () => {
        expect(typeof handler(name)).toBe('function');
        expect(guardsOf(handler(name))).toContain(JwtAuthGuard);
      });
    },
  );

  describe.each(['publicBrand', 'logo', 'domainCheck'])('public handler %s', (name) => {
    it('exists with no guard on the handler', () => {
      expect(typeof handler(name)).toBe('function');
      expect(guardsOf(handler(name))).toEqual([]);
    });

    it('has a throttle override', () => {
      const keys = Reflect.getMetadataKeys(handler(name)).map(String);
      expect(keys.some((k) => k.startsWith('THROTTLER'))).toBe(true);
    });
  });

  describe.each([
    ['publicBrand', GET, 'branding/public'],
    ['logo', GET, 'branding/logo/:orgId'],
    ['domainCheck', GET, 'branding/domain-check'],
    ['getBrand', GET, 'branding'],
    ['updateBrand', PUT, 'branding'],
    ['uploadLogo', POST, 'branding/logo'],
    ['removeLogo', DELETE, 'branding/logo'],
    ['listDomains', GET, 'branding/domains'],
    ['addDomain', POST, 'branding/domains'],
    ['verifyDomain', POST, 'branding/domains/:domainId/verify'],
    ['removeDomain', DELETE, 'branding/domains/:domainId'],
  ])('route for %s', (name, method, path) => {
    it(`is ${['GET', 'POST', 'PUT', 'DELETE'][method as number]} ${path}`, () => {
      const normalise = (p: string) => String(p).replace(/^\/+/, '');
      const controllerPath = normalise(Reflect.getMetadata('path', BrandingController) ?? '');
      const handlerPath = normalise(Reflect.getMetadata('path', handler(name as string)) ?? '');
      const full = [controllerPath, handlerPath].filter(Boolean).join('/');
      expect(Reflect.getMetadata('method', handler(name as string))).toBe(method);
      expect(full).toBe(path);
    });
  });
});
