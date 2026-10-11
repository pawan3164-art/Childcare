import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { AuthorizationService } from '../../src/authorization/authorization.service';
import { fixturePrisma } from '../test-utils';

export { NOW, TODAY, addDays, makeUser, makeChild, link, setupFamily, auditFor } from '../u3-family-requests/helpers';
export { fixturePrisma };

/** Internals that must never be returned to any caller. */
export const FORBIDDEN_KEYS = ['createdByUserId', 'cancelledByUserId', 'updatedByUserId', 'orgId', 'centreId'];

async function buildCommon() {
  const prismaService = new PrismaService();
  await prismaService.onModuleInit();
  const tenancy = new TenancyService(prismaService);
  const audit = new AuditService(tenancy);
  const authorization = new AuthorizationService(tenancy, audit);
  return { prismaService, tenancy, audit, authorization };
}

export async function buildCalendar() {
  const c = await buildCommon();
  // Lazy require so every suite fails for the same reason (missing module) until src/calendar exists.
  const mod = require('../../src/calendar/calendar.service');
  const service = new mod.CalendarService(c.tenancy, c.audit, c.authorization);
  return { ...c, service, mod };
}

export async function buildMenus() {
  const c = await buildCommon();
  const mod = require('../../src/menus/menus.service');
  const service = new mod.MenusService(c.tenancy, c.audit, c.authorization);
  return { ...c, service, mod };
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

export async function seedEvent(
  tenant: { orgId: string; centreId: string },
  adminUserId: string,
  opts: { title?: string; startsAt?: string; endsAt?: string | null; roomId?: string | null; allDay?: boolean; cancelled?: boolean } = {},
) {
  return fixturePrisma.centreEvent.create({
    data: {
      orgId: tenant.orgId,
      centreId: tenant.centreId,
      title: opts.title ?? 'Seeded event',
      startsAt: new Date(opts.startsAt ?? '2026-10-20T00:00:00Z'),
      endsAt: opts.endsAt ? new Date(opts.endsAt) : null,
      allDay: opts.allDay ?? false,
      roomId: opts.roomId ?? null,
      createdByUserId: adminUserId,
      cancelledAt: opts.cancelled ? new Date('2026-10-01T00:00:00Z') : null,
      cancelledByUserId: opts.cancelled ? adminUserId : null,
      cancelReason: opts.cancelled ? 'Seeded cancel' : null,
    },
  });
}

export async function seedMenu(
  tenant: { orgId: string; centreId: string },
  adminUserId: string,
  date: string,
  meal: 'MORNING_TEA' | 'LUNCH' | 'AFTERNOON_TEA' | 'LATE_SNACK',
  description = 'Pasta',
  allergenNotes: string | null = null,
) {
  return fixturePrisma.menuItem.create({
    data: { orgId: tenant.orgId, centreId: tenant.centreId, date: new Date(`${date}T00:00:00Z`), meal, description, allergenNotes, updatedByUserId: adminUserId },
  });
}
