import { randomUUID } from 'crypto';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { AuthorizationService } from '../../src/authorization/authorization.service';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { StubPushProvider } from '../../src/notifications/providers/stub-push.provider';
import { MediaService } from '../../src/media/media.service';
import { InMemoryObjectStorage } from '../../src/media/storage/in-memory-object-storage';
import { LearningService } from '../../src/learning/learning.service';
import { EYLF_OUTCOMES } from '../../src/learning/eylf';
import { RequestUser } from '../../src/authorization/request-user.interface';
import { appPrisma, disconnectAll, fixturePrisma, seedOrgCentreRoom, setTenantContext, uniqueSuffix } from '../test-utils';

/**
 * U2 learning in the feed (BRD v2.2 §10, EDU-004/005/010, PAR-010).
 * Observations and learning stories are written by educators (auto-saved
 * drafts), reviewed by someone other than the author, then published to the
 * families of the tagged children. Group stories follow the group-photo
 * consent rule (ADR 0004): a family sees a story that also tags other
 * children only if those children have group consent.
 */
describe('LearningService: observations and learning stories', () => {
  let prismaService: PrismaService;
  let learning: LearningService;

  beforeAll(async () => {
    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    const tenancy = new TenancyService(prismaService);
    const audit = new AuditService(tenancy);
    const authorization = new AuthorizationService(tenancy, audit);
    const media = new MediaService(tenancy, audit, authorization, new InMemoryObjectStorage());
    learning = new LearningService(tenancy, audit, authorization, media, new NotificationsService(tenancy, new StubPushProvider()));
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  async function staff(tenant: { orgId: string; centreId: string }, role: 'EDUCATOR' | 'CENTRE_ADMIN', roomId?: string): Promise<RequestUser> {
    const u = await fixturePrisma.user.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, email: `${role}-${uniqueSuffix()}@example.test`, passwordHash: 'x', role, firstName: role === 'EDUCATOR' ? 'Priya' : 'Alex', lastName: 'T' },
    });
    if (roomId) {
      await fixturePrisma.staffRoomAssignment.create({ data: { orgId: tenant.orgId, centreId: tenant.centreId, userId: u.id, roomId, startDate: new Date('2026-01-01') } });
    }
    return { userId: u.id, orgId: tenant.orgId, centreId: tenant.centreId, role, sessionId: 's' };
  }

  async function family(tenant: { orgId: string; centreId: string; roomId: string }, consent = true) {
    const child = await fixturePrisma.child.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, roomId: tenant.roomId, firstName: 'Kid', lastName: `L-${uniqueSuffix()}`, dateOfBirth: new Date('2023-02-01'), groupPhotoConsent: consent },
    });
    const guardian = await fixturePrisma.user.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, email: `g-${uniqueSuffix()}@example.test`, passwordHash: 'x', role: 'PARENT', firstName: 'G', lastName: 'P' },
    });
    await fixturePrisma.guardianChildRelationship.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, guardianUserId: guardian.id, childId: child.id, relationshipType: 'PARENT' },
    });
    const user: RequestUser = { userId: guardian.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'PARENT', sessionId: 's' };
    return { child, user };
  }

  async function setup(label: string) {
    const tenant = await seedOrgCentreRoom(label);
    const author = await staff(tenant, 'EDUCATOR', tenant.roomId);
    const colleague = await staff(tenant, 'EDUCATOR', tenant.roomId);
    const admin = await staff(tenant, 'CENTRE_ADMIN');
    const a = await family(tenant);
    const b = await family(tenant);
    return { tenant, author, colleague, admin, a, b };
  }

  function draft(roomId: string, childIds: string[], extra: Record<string, unknown> = {}) {
    return {
      id: randomUUID(),
      roomId,
      kind: 'LEARNING_STORY' as const,
      title: 'Building a bridge',
      observation: 'Built a bridge from blocks and tested it with a toy car.',
      interpretation: 'Testing ideas and adjusting the design.',
      outcomes: ['4.2', '5.3'],
      reflection: 'Internal: offer more ramps next week.',
      nextSteps: 'Add ramps and measuring tapes to the block corner.',
      childIds,
      mediaAssetIds: [] as string[],
      ...extra,
    };
  }

  it('ships the EYLF V2.0 outcome list and rejects unknown outcome codes', async () => {
    expect(EYLF_OUTCOMES.map((o) => o.code)).toEqual(['1.1', '1.2', '1.3', '1.4', '2.1', '2.2', '2.3', '2.4', '3.1', '3.2', '4.1', '4.2', '4.3', '4.4', '5.1', '5.2', '5.3', '5.4', '5.5']);
    const { tenant, author, a } = await setup('LrnOutcomes');
    await expect(learning.saveDraft(author, draft(tenant.roomId, [a.child.id], { outcomes: ['9.9'] }))).rejects.toThrow(/outcome/i);
  });

  it('auto-saves a draft under the client id; drafts are private to the author (and admins)', async () => {
    const { tenant, author, colleague, admin, a } = await setup('LrnDraft');
    const input = draft(tenant.roomId, [a.child.id], { title: 'First go' });
    await learning.saveDraft(author, input);
    const saved = await learning.saveDraft(author, { ...input, title: 'Second go' });
    expect(saved).toMatchObject({ id: input.id, status: 'DRAFT', title: 'Second go' });
    expect(await fixturePrisma.learningRecord.count({ where: { id: input.id } })).toBe(1);

    await expect(learning.get(colleague, input.id)).rejects.toThrow();
    await expect(learning.get(a.user, input.id)).rejects.toThrow();
    await expect(learning.get(admin, input.id)).resolves.toMatchObject({ title: 'Second go' });
    // Someone else can't overwrite the author's draft by reusing its id.
    await expect(learning.saveDraft(colleague, { ...input, title: 'Hijack' })).rejects.toThrow();
  });

  it('only staff who can see every tagged child can write about them', async () => {
    const { tenant, a } = await setup('LrnAccess');
    const otherRoom = await fixturePrisma.room.create({ data: { orgId: tenant.orgId, centreId: tenant.centreId, name: `Other ${uniqueSuffix()}` } });
    const outsider = await staff(tenant, 'EDUCATOR', otherRoom.id);
    await expect(learning.saveDraft(outsider, draft(tenant.roomId, [a.child.id]))).rejects.toThrow();
    await expect(learning.saveDraft(a.user, draft(tenant.roomId, [a.child.id]))).rejects.toThrow();
  });

  it('review workflow: the author submits, cannot self-publish; a colleague publishes; guardians are notified with ids only', async () => {
    const { tenant, author, colleague, a } = await setup('LrnPublish');
    const input = draft(tenant.roomId, [a.child.id]);
    await learning.saveDraft(author, input);

    await expect(learning.submit(author, input.id)).resolves.toMatchObject({ status: 'IN_REVIEW' });
    await expect(learning.publish(author, input.id)).rejects.toThrow(/review/i);
    await expect(learning.publish(a.user, input.id)).rejects.toThrow();

    const published = await learning.publish(colleague, input.id);
    expect(published).toMatchObject({ status: 'PUBLISHED', reviewedByUserId: colleague.userId });
    expect(published.publishedAt).toBeInstanceOf(Date);

    await setTenantContext(appPrisma, tenant.orgId, tenant.centreId);
    const notes = await appPrisma.notificationQueueItem.findMany({ where: { recipientUserId: a.user.userId } });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ priority: 'CHILD_UPDATE' });
    expect(notes[0].payload).toMatchObject({ type: 'learning_published', learningRecordId: input.id, childId: a.child.id });
    expect(JSON.stringify(notes[0].payload)).not.toMatch(/bridge/i);
  });

  it('a submission needs a title, an observation, a child and at least one outcome', async () => {
    const { tenant, author, a } = await setup('LrnSubmitRules');
    const input = draft(tenant.roomId, [a.child.id], { observation: '', outcomes: [] });
    await learning.saveDraft(author, input);
    await expect(learning.submit(author, input.id)).rejects.toThrow(/observation|outcome/i);
  });

  it('a reviewer can return it for changes; the full approval history is kept', async () => {
    const { tenant, author, admin, a } = await setup('LrnHistory');
    const input = draft(tenant.roomId, [a.child.id]);
    await learning.saveDraft(author, input);
    await learning.submit(author, input.id);
    await expect(learning.returnForChanges(admin, input.id, 'Please add an outcome for wellbeing')).resolves.toMatchObject({ status: 'DRAFT' });
    await learning.saveDraft(author, { ...input, outcomes: ['3.1', '4.2'] });
    await learning.submit(author, input.id);
    await learning.publish(admin, input.id);

    const view = await learning.get(admin, input.id);
    expect(view.history.map((h) => h.action)).toEqual(['SUBMITTED', 'RETURNED', 'SUBMITTED', 'PUBLISHED']);
    expect(view.history[1]).toMatchObject({ actor: { firstName: 'Alex' }, note: 'Please add an outcome for wellbeing' });
    expect(view.history[3].snapshot).toMatchObject({ outcomes: ['3.1', '4.2'] });

    // History rows are append-only for the app role.
    await setTenantContext(appPrisma, tenant.orgId, tenant.centreId);
    const rows = await appPrisma.learningRecordEvent.findMany({ where: { learningRecordId: input.id } });
    await expect(appPrisma.learningRecordEvent.update({ where: { id: rows[0].id }, data: { note: 'x' } })).rejects.toThrow();
  });

  it('published records can be amended by the author (EDU-010); each amendment is versioned', async () => {
    const { tenant, author, colleague, a } = await setup('LrnAmend');
    const input = draft(tenant.roomId, [a.child.id]);
    await learning.saveDraft(author, input);
    await learning.submit(author, input.id);
    await learning.publish(colleague, input.id);

    const amended = await learning.amend(author, input.id, { nextSteps: 'Ramps, tapes and a ruler.' });
    expect(amended).toMatchObject({ status: 'PUBLISHED', nextSteps: 'Ramps, tapes and a ruler.', version: 2 });
    await expect(learning.amend(colleague, input.id, { title: 'Not mine' })).rejects.toThrow();

    const view = await learning.get(author, input.id);
    const amendEvent = view.history.find((h) => h.action === 'AMENDED');
    expect(amendEvent?.snapshot).toMatchObject({ nextSteps: 'Ramps, tapes and a ruler.' });
    expect(view.history.find((h) => h.action === 'PUBLISHED')?.snapshot).toMatchObject({ nextSteps: 'Add ramps and measuring tapes to the block corner.' });
  });

  it('parents see published records about their own child, without the internal reflection; other families cannot', async () => {
    const { tenant, author, colleague, a, b } = await setup('LrnParent');
    const input = draft(tenant.roomId, [a.child.id]);
    await learning.saveDraft(author, input);
    await learning.submit(author, input.id);
    await learning.publish(colleague, input.id);

    const seen = await learning.get(a.user, input.id);
    expect(seen).toMatchObject({ title: 'Building a bridge', nextSteps: expect.any(String) });
    expect(seen.reflection).toBeUndefined();
    expect(seen.history).toEqual([]);
    expect(seen.outcomes[0]).toMatchObject({ code: '4.2', label: expect.stringMatching(/problem solving/i) });

    await expect(learning.get(b.user, input.id)).rejects.toThrow();
  });

  it('group stories follow the group-consent rule for each family', async () => {
    const tenant = await seedOrgCentreRoom('LrnGroup');
    const author = await staff(tenant, 'EDUCATOR', tenant.roomId);
    const admin = await staff(tenant, 'CENTRE_ADMIN');
    const consenting = await family(tenant, true);
    const notConsenting = await family(tenant, false);
    const input = draft(tenant.roomId, [consenting.child.id, notConsenting.child.id]);
    await learning.saveDraft(author, input);
    await learning.submit(author, input.id);
    await learning.publish(admin, input.id);

    // The consenting family would see another child who has not consented: hidden.
    await expect(learning.get(consenting.user, input.id)).rejects.toThrow();
    // The non-consenting family sees their own child plus a consenting one: visible.
    await expect(learning.get(notConsenting.user, input.id)).resolves.toMatchObject({ id: input.id });

    const portfolioA = await learning.portfolio(consenting.user, consenting.child.id, {});
    expect(portfolioA.items.find((i) => i.id === input.id)).toBeUndefined();
    const portfolioB = await learning.portfolio(notConsenting.user, notConsenting.child.id, {});
    expect(portfolioB.items.find((i) => i.id === input.id)).toBeDefined();
  });

  it('attached photos must only show children the story is about', async () => {
    const { tenant, author, a, b } = await setup('LrnMedia');
    const photoOfB = await fixturePrisma.mediaAsset.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, roomId: tenant.roomId, storageKey: `k/${uniqueSuffix()}`, capturedByUserId: author.userId, childTags: { create: [{ orgId: tenant.orgId, childId: b.child.id }] } },
    });
    await expect(learning.saveDraft(author, draft(tenant.roomId, [a.child.id], { mediaAssetIds: [photoOfB.id] }))).rejects.toThrow(/photo/i);

    const photoOfA = await fixturePrisma.mediaAsset.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, roomId: tenant.roomId, storageKey: `k/${uniqueSuffix()}`, capturedByUserId: author.userId, childTags: { create: [{ orgId: tenant.orgId, childId: a.child.id }] } },
    });
    const saved = await learning.saveDraft(author, draft(tenant.roomId, [a.child.id], { mediaAssetIds: [photoOfA.id] }));
    expect(saved.mediaAssetIds).toEqual([photoOfA.id]);
  });

  it('staff search by child, outcome, author, status and date', async () => {
    const { tenant, author, colleague, admin, a, b } = await setup('LrnSearch');
    const one = draft(tenant.roomId, [a.child.id], { outcomes: ['1.1'] });
    const two = draft(tenant.roomId, [b.child.id], { outcomes: ['5.1'] });
    await learning.saveDraft(author, one);
    await learning.submit(author, one.id);
    await learning.publish(colleague, one.id);
    await learning.saveDraft(colleague, two);
    await learning.submit(colleague, two.id);

    const ids = async (f: Parameters<LearningService['search']>[1]) => (await learning.search(admin, f)).map((r) => r.id);
    expect(await ids({ childId: a.child.id })).toEqual([one.id]);
    expect(await ids({ outcome: '5.1' })).toEqual([two.id]);
    expect(await ids({ authorId: author.userId })).toEqual([one.id]);
    expect(await ids({ roomId: tenant.roomId, status: 'IN_REVIEW' })).toEqual([two.id]);
    expect((await ids({ roomId: tenant.roomId, from: '2000-01-01', to: '2999-01-01' })).sort()).toEqual([one.id, two.id].sort());
    await expect(learning.search(a.user, { childId: a.child.id })).rejects.toThrow();
  });
});
