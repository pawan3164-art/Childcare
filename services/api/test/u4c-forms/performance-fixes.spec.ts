import { BadRequestException } from '@nestjs/common';
import { disconnectAll } from '../test-utils';
import { NOW, auditFor, buildForms, db, link, makeChild, makeUser, publishedTemplate, setupFamily } from './helpers';

/** OI-42: bulk send is batched and the request lists are paginated. */
describe('U4c forms: bulk send and pagination (OI-42)', () => {
  let h: Awaited<ReturnType<typeof buildForms>>;
  let svc: any;
  beforeAll(async () => {
    h = await buildForms();
    svc = h.service;
  });
  afterAll(async () => {
    await disconnectAll();
  });
  afterEach(() => jest.restoreAllMocks());

  async function sendToMany(label: string, n: number) {
    const f = await setupFamily(label);
    const { templateId, version } = await publishedTemplate(svc, f.admin);
    const recipients = [{ guardianUserId: f.parent.userId, childId: f.child.id }];
    for (let i = 1; i < n; i++) {
      const kid = await makeChild(f.tenant);
      const p = await makeUser(f.tenant, 'PARENT');
      await link(f.tenant, p, kid.id);
      recipients.push({ guardianUserId: p.userId, childId: kid.id });
    }
    return { f, templateId, version, recipients };
  }

  it('writes one audit entry and one queued notification per request without one round trip each', async () => {
    const { f, templateId, version, recipients } = await sendToMany('perf-send', 6);
    const single = jest.spyOn(h.notifications, 'enqueue');
    const out = await svc.sendRequests(f.admin, { templateId, version, recipients }, NOW);
    expect(out).toHaveLength(6);
    expect(single).not.toHaveBeenCalled(); // the batch path is used
    for (const r of out) {
      expect((await auditFor(r.id)).filter((a: any) => a.action === 'forms.request_sent')).toHaveLength(1);
      const items = await db.notificationQueueItem.findMany({ where: { payload: { path: ['formRequestId'], equals: r.id } } });
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ priority: 'ACTION_REQUIRED', channel: 'PUSH', status: 'QUEUED' });
    }
  });

  it('a notification failure still returns the saved requests', async () => {
    const { f, templateId, version, recipients } = await sendToMany('perf-notif-fail', 2);
    jest.spyOn(h.notifications, 'enqueueMany').mockRejectedValue(new Error('queue down'));
    const out = await svc.sendRequests(f.admin, { templateId, version, recipients }, NOW);
    expect(out).toHaveLength(2);
    expect(await db.formRequest.count({ where: { templateId } })).toBe(2);
  });

  describe('pagination', () => {
    it('admin list: limit and cursor walk the whole set newest first with no gaps or repeats', async () => {
      const { f, templateId, version, recipients } = await sendToMany('perf-page', 5);
      await svc.sendRequests(f.admin, { templateId, version, recipients }, NOW);
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < 10; i++) {
        const page = await svc.listRequests(f.admin, { limit: 2, cursor }, NOW);
        expect(page.length).toBeLessThanOrEqual(2);
        seen.push(...page.map((r: any) => r.id));
        if (page.length < 2) break;
        cursor = page[page.length - 1].id;
      }
      expect(seen).toHaveLength(5);
      expect(new Set(seen).size).toBe(5);
    });

    it('defaults to 100 rows and rejects a bad limit or cursor', async () => {
      const f = await setupFamily('perf-page-bad');
      await expect(svc.listRequests(f.admin, { limit: '0' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.listRequests(f.admin, { limit: '501' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.listRequests(f.admin, { limit: 'abc' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.listRequests(f.admin, { cursor: 'not-a-uuid' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.listRequests(f.admin, {}, NOW)).resolves.toEqual([]);
    });

    it('parent list paginates the same way and never leaks another family', async () => {
      const { f, templateId, version } = await sendToMany('perf-page-parent', 1);
      for (let i = 0; i < 3; i++) await svc.sendRequests(f.admin, { templateId, version, recipients: [{ guardianUserId: f.parent.userId, childId: f.child.id }] }, NOW);
      const first = await svc.listMyRequests(f.parent, { limit: 2 }, NOW);
      expect(first).toHaveLength(2);
      const rest = await svc.listMyRequests(f.parent, { limit: 2, cursor: first[1].id }, NOW);
      expect(rest).toHaveLength(1);
      expect(rest[0].id).not.toBe(first[0].id);
    });
  });
});
