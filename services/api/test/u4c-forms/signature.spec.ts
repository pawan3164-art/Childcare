import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { disconnectAll } from '../test-utils';
import { META, NOW, buildForms, db, makeChild, link, makeUser, pendingRequest, validAnswers } from './helpers';
import { FormsController } from '../../src/forms/forms.controller';

const strokes = () => [
  [[0.1, 0.5], [0.3, 0.2], [0.5, 0.6]],
  [[0.6, 0.4], [0.9, 0.5]],
];

/** U4c: the drawn signature is captured as strokes by the server, so the reference on a submission is real. */
describe('U4c forms: drawn signature capture', () => {
  let h: Awaited<ReturnType<typeof buildForms>>;
  let svc: any;
  beforeAll(async () => {
    h = await buildForms();
    svc = h.service;
  });
  afterAll(async () => {
    await disconnectAll();
  });

  const submitWith = (f: any, imageRef: string, now = NOW) =>
    // raw service: bypass the test wrapper so the real reference is what is checked
    h.mod.FormsService.prototype.submitRequest.call(svc, f.parent, f.req.id, { answers: validAnswers(), signature: { typedName: 'Jane Citizen', imageRef, consent: true } }, META, now);

  it('stores the strokes and returns a server-issued reference under signatures/', async () => {
    const f = await pendingRequest(svc, 'sg-ok');
    const out = await svc.saveSignature(f.parent, f.req.id, { strokes: strokes() }, NOW);
    expect(out.imageRef).toMatch(/^signatures\/[0-9a-f-]{36}$/);
    const row = await db.formSignature.findFirstOrThrow({ where: { requestId: f.req.id } });
    expect(row.guardianUserId).toBe(f.parent.userId);
    expect(row.strokes).toEqual(strokes());
  });

  it('a reference from saveSignature signs the form', async () => {
    const f = await pendingRequest(svc, 'sg-sign');
    const { imageRef } = await svc.saveSignature(f.parent, f.req.id, { strokes: strokes() }, NOW);
    const out = await submitWith(f, imageRef);
    expect(out.status).toBe('SIGNED');
    expect((await db.formSubmission.findUniqueOrThrow({ where: { id: out.id } })).signatureImageRef).toBe(imageRef);
  });

  it('rejects a reference that was never issued, or that belongs to another request or guardian', async () => {
    const f = await pendingRequest(svc, 'sg-own');
    const g = await pendingRequest(svc, 'sg-own-other');
    const theirs = await svc.saveSignature(g.parent, g.req.id, { strokes: strokes() }, NOW);
    for (const ref of ['signatures/00000000-0000-0000-0000-000000000000', theirs.imageRef, 'signatures/sig-abc123.png']) {
      await expect(submitWith(f, ref)).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(await db.formSubmission.count({ where: { requestId: f.req.id } })).toBe(0);
  });

  it.each([
    ['no strokes', []],
    ['not a list', 'x'],
    ['a stroke with one point', [[[0.1, 0.1]]]],
    ['a point outside 0..1', [[[0.1, 0.1], [2, 0.5]]]],
    ['a non-numeric point', [[[0.1, 0.1], ['a', 0.5]]]],
    ['a point with three values', [[[0.1, 0.1], [0.2, 0.2, 0.3]]]],
    ['more than 20 strokes', Array.from({ length: 21 }, () => [[0.1, 0.1], [0.2, 0.2]])],
    ['more than 500 points in a stroke', [Array.from({ length: 501 }, () => [0.1, 0.1])]],
  ])('rejects %s', async (_n, bad) => {
    const f = await pendingRequest(svc, 'sg-bad');
    await expect(svc.saveSignature(f.parent, f.req.id, { strokes: bad as any }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    expect(await db.formSignature.count({ where: { requestId: f.req.id } })).toBe(0);
  });

  it('only the addressed guardian, and only while the request is pending', async () => {
    const f = await pendingRequest(svc, 'sg-who');
    const other = await makeUser(f.tenant, 'PARENT');
    await link(f.tenant, other, (await makeChild(f.tenant)).id);
    await expect(svc.saveSignature(other, f.req.id, { strokes: strokes() }, NOW)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.saveSignature(f.admin, f.req.id, { strokes: strokes() }, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    await svc.cancelRequest(f.admin, f.req.id, NOW);
    await expect(svc.saveSignature(f.parent, f.req.id, { strokes: strokes() }, NOW)).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows at most 5 saved signatures per request', async () => {
    const f = await pendingRequest(svc, 'sg-cap');
    for (let i = 0; i < 5; i++) await svc.saveSignature(f.parent, f.req.id, { strokes: strokes() }, NOW);
    await expect(svc.saveSignature(f.parent, f.req.id, { strokes: strokes() }, NOW)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('saved signatures cannot be changed or deleted (grants)', async () => {
    const f = await pendingRequest(svc, 'sg-immutable');
    await svc.saveSignature(f.parent, f.req.id, { strokes: strokes() }, NOW);
    const sql = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'prisma', 'migrations', require('fs').readdirSync(require('path').join(__dirname, '..', '..', 'prisma', 'migrations')).filter((n: string) => /u4c_signatures/.test(n))[0], 'migration.sql'), 'utf8');
    expect(sql).toMatch(/GRANT SELECT, INSERT ON form_signatures TO childcare_app/);
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
  });

  it('has a throttled POST route', () => {
    const fn = (FormsController.prototype as any).saveSignature;
    expect(Reflect.getMetadata('path', fn)).toBe('forms/my-requests/:id/signature');
    expect(Reflect.getMetadataKeys(fn).some((k: unknown) => /THROTTLER.*(LIMIT|TTL)/i.test(String(k)))).toBe(true);
  });
});
