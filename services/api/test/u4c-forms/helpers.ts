import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { AuthorizationService } from '../../src/authorization/authorization.service';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { StubPushProvider } from '../../src/notifications/providers/stub-push.provider';
import { fixturePrisma } from '../test-utils';
import { NOW, setupFamily } from '../u3-family-requests/helpers';

export { NOW, TODAY, addDays, makeUser, makeChild, link, setupFamily, auditFor } from '../u3-family-requests/helpers';
export { fixturePrisma };

/** Prisma delegates for the new tables do not exist until the schema lands; reach them untyped. */
export const db: any = fixturePrisma;

/** Internals that must never be returned to any caller. */
export const FORBIDDEN_KEYS = ['createdByUserId', 'cancelledByUserId', 'updatedByUserId', 'publishedByUserId', 'orgId', 'centreId', 'ip', 'userAgent'];

export const PLACEHOLDER_REFS = ['signatures/sig-abc123.png', 'signatures/SecretImgXyz.png'];

export const META = { ip: '203.0.113.9', userAgent: 'TestAgent/1.0' };

export async function buildForms() {
  const prismaService = new PrismaService();
  await prismaService.onModuleInit();
  const tenancy = new TenancyService(prismaService);
  const audit = new AuditService(tenancy);
  const authorization = new AuthorizationService(tenancy, audit);
  const notifications = new NotificationsService(tenancy, new StubPushProvider());
  // Lazy require so every suite fails for the same reason (missing module) until src/forms exists.
  const mod = require('../../src/forms/forms.service');
  const hashMod = () => require('../../src/forms/forms-hash');
  const service = new mod.FormsService(tenancy, audit, authorization, notifications);
  // Most suites sign with a placeholder reference; swap it for a real saved signature so they exercise everything else.
  const rawSubmit = service.submitRequest.bind(service);
  service.submitRequest = async (parent: any, requestId: string, dto: any, meta: any, now: any) => {
    const ref = dto?.signature?.imageRef;
    if (typeof ref === 'string' && PLACEHOLDER_REFS.includes(ref)) {
      const saved = await service.saveSignature(parent, requestId, { strokes: [[[0.1, 0.1], [0.5, 0.5]]] }, now).catch(() => null);
      if (saved) dto = { ...dto, signature: { ...dto.signature, imageRef: saved.imageRef } };
    }
    return rawSubmit(parent, requestId, dto, meta, now);
  };
  return { prismaService, tenancy, audit, authorization, notifications, service, mod, hashMod };
}

export function expectNoInternals(value: unknown): void {
  const walk = (v: any) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      for (const k of FORBIDDEN_KEYS) expect(Object.keys(v)).not.toContain(k);
      Object.values(v).forEach(walk);
    }
  };
  walk(value);
}

/** A valid field set exercising every field type. */
export function allFields() {
  return [
    { key: 'full_name', type: 'text', label: 'Parent full name', required: true },
    { key: 'excursion_date', type: 'date', label: 'Excursion date', required: true },
    { key: 'swim_ok', type: 'yes_no', label: 'Permission to swim', required: true },
    { key: 'transport', type: 'choice', label: 'Transport', required: false, options: ['Bus', 'Walk', 'Car'] },
    { key: 'which_child', type: 'child_select', label: 'Which child', required: false },
    { key: 'sig', type: 'signature', label: 'Parent signature', required: true },
  ];
}

export function validAnswers() {
  return { full_name: 'Jane Citizen', excursion_date: '2026-11-02', swim_ok: true, transport: 'Bus' };
}

export function validSignature(overrides: Record<string, unknown> = {}) {
  return { typedName: 'Jane Citizen', imageRef: 'signatures/sig-abc123.png', consent: true, ...overrides };
}

/** Create and publish a template; returns the published version number too. */
export async function publishedTemplate(svc: any, admin: any, fields: any[] = allFields(), now = NOW) {
  const t = await svc.createTemplate(admin, { title: 'Excursion consent', description: 'Annual excursion', fields }, now);
  const v = await svc.publishTemplate(admin, t.id, now);
  return { templateId: t.id as string, version: v.version as number };
}

/** Family + a published template + one pending request for the family's parent and child. */
export async function pendingRequest(svc: any, label: string, fields: any[] = allFields()) {
  const f = await setupFamily(label);
  const { templateId, version } = await publishedTemplate(svc, f.admin, fields);
  const [req] = await svc.sendRequests(
    f.admin,
    { templateId, version, recipients: [{ guardianUserId: f.parent.userId, childId: f.child.id }] },
    NOW,
  );
  return { ...f, templateId, version, req };
}
