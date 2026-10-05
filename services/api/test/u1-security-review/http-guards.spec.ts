import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { MediaController } from '../../src/media/media.controller';
import { MediaService } from '../../src/media/media.service';
import { SyncController } from '../../src/sync/sync.controller';
import { SyncService } from '../../src/sync/sync.service';
import { JwtAuthGuard } from '../../src/authorization/guards/jwt-auth.guard';

/**
 * U1 security review H1 / L5: multipart parsing is only reachable by staff,
 * with tight multer limits, and sync batches are size-capped.
 */
describe('U1 security review: HTTP-level guards', () => {
  let app: INestApplication;
  let role = 'PARENT';
  const upload = jest.fn(async () => ({ id: 'm1' }));
  const submit = jest.fn(async () => ({ status: 'APPLIED' }));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MediaController, SyncController],
      providers: [
        { provide: MediaService, useValue: { upload } },
        { provide: SyncService, useValue: { submit } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: { switchToHttp: () => { getRequest: () => { user?: unknown } } }) => {
          ctx.switchToHttp().getRequest().user = { userId: 'u', orgId: 'o', centreId: 'c', role, sessionId: 's' };
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(() => app.close());
  beforeEach(() => {
    upload.mockClear();
    submit.mockClear();
  });

  it('rejects a parent before the upload body is parsed', async () => {
    role = 'PARENT';
    const res = await request(app.getHttpServer()).post('/media/upload').attach('file', Buffer.from('x'), 'a.png').field('childIds', '["c1"]');
    expect(res.status).toBe(403);
    expect(upload).not.toHaveBeenCalled();
  });

  it('limits multipart fields for staff', async () => {
    role = 'EDUCATOR';
    let req = request(app.getHttpServer()).post('/media/upload').attach('file', Buffer.from('x'), 'a.png');
    for (let i = 0; i < 20; i++) req = req.field(`f${i}`, 'v');
    const res = await req;
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(upload).not.toHaveBeenCalled();

    const ok = await request(app.getHttpServer()).post('/media/upload').attach('file', Buffer.from('x'), 'a.png').field('childIds', '["c1"]').field('roomId', 'r1');
    expect(ok.status).toBe(201);
  });

  it('caps the sync batch size', async () => {
    role = 'EDUCATOR';
    const op = { idempotencyKey: 'k', clientOperationId: 'o', entityType: 'X', entityId: 'e', operationType: 'CREATE', clientTimestamp: new Date().toISOString(), payload: {} };
    const res = await request(app.getHttpServer()).post('/sync/operations').send(Array.from({ length: 101 }, () => op));
    expect(res.status).toBe(400);
    expect(submit).not.toHaveBeenCalled();
  });
});
