import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SyncController } from '../../src/sync/sync.controller';
import { SyncService } from '../../src/sync/sync.service';
import { JwtAuthGuard } from '../../src/authorization/guards/jwt-auth.guard';

/**
 * POST /sync/operations takes a batch. Found while wiring offline checklists:
 * a non-array body crashed with a 500, and the global ValidationPipe does not
 * validate array elements, so malformed operations reached SyncService.
 */
describe('SyncController: batch validation', () => {
  let app: INestApplication;
  const submit = jest.fn(async (_user: unknown, op: { entityId: string }) => ({ entityId: op.entityId, status: 'APPLIED' }));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SyncController],
      providers: [{ provide: SyncService, useValue: { submit } }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: { switchToHttp: () => { getRequest: () => { user?: unknown } } }) => {
          ctx.switchToHttp().getRequest().user = { userId: 'u', orgId: 'o', centreId: 'c', role: 'EDUCATOR', sessionId: 's' };
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(() => app.close());
  beforeEach(() => submit.mockClear());

  const valid = {
    idempotencyKey: 'k1',
    clientOperationId: 'o1',
    entityType: 'ChecklistCompletion',
    entityId: 'e1',
    operationType: 'CREATE',
    clientTimestamp: new Date().toISOString(),
    payload: { a: 1 },
  };

  it('accepts a batch of valid operations', async () => {
    const res = await request(app.getHttpServer()).post('/sync/operations').send([valid]);
    expect(res.status).toBe(201);
    expect(res.body.results).toHaveLength(1);
  });

  it('rejects a body that is not an array with 400, not 500', async () => {
    const res = await request(app.getHttpServer()).post('/sync/operations').send(valid);
    expect(res.status).toBe(400);
    expect(submit).not.toHaveBeenCalled();
  });

  it('validates every operation in the batch', async () => {
    const { idempotencyKey: _omit, ...missingKey } = valid;
    const res = await request(app.getHttpServer()).post('/sync/operations').send([valid, missingKey]);
    expect(res.status).toBe(400);
    expect(submit).not.toHaveBeenCalled();
  });
});
