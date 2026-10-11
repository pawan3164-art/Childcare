import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MenuMeal, Prisma } from '@prisma/client';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { RequestUser } from '../authorization/request-user.interface';
import { addDaysToDate, centreDateString, isRealDate } from '../common/time/centre-day';
import { assertAdmin, centreScope, parentChildRooms, CentreScope } from '../common/centre-access';

const MEALS: MenuMeal[] = ['MORNING_TEA', 'LUNCH', 'AFTERNOON_TEA', 'LATE_SNACK'];
const MAX_RANGE_DAYS = 31;

function present(m: { id: string; date: Date; meal: MenuMeal; description: string; allergenNotes: string | null; updatedAt: Date }) {
  return { id: m.id, date: m.date.toISOString().slice(0, 10), meal: m.meal, description: m.description, allergenNotes: m.allergenNotes, updatedAt: m.updatedAt };
}

function meal(value: string): MenuMeal {
  if (!MEALS.includes(value as MenuMeal)) throw new BadRequestException('Meal is not valid');
  return value as MenuMeal;
}

function day(value: string, label: string): string {
  if (!isRealDate(value)) throw new BadRequestException(`${label} must be a real date (YYYY-MM-DD)`);
  return value;
}

/** Weekly menus (U4b): information for families, not a care record, so an item can be replaced or cleared. Audited by id and meal only. */
@Injectable()
export class MenusService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
  ) {}

  /** Written in the change's own transaction: no committed change without its audit entry. */
  private record(tx: Prisma.TransactionClient, admin: RequestUser, scope: CentreScope, action: string, id: string, mealKey: MenuMeal) {
    return this.audit.record(
      { orgId: scope.orgId, centreId: scope.centreId, actorUserId: admin.userId, actorRole: admin.role, action, entityType: 'MenuItem', entityId: id, outcome: 'SUCCESS', metadata: { meal: mealKey } },
      tx,
    );
  }

  async list(user: RequestUser, range: { from?: string; to?: string } = {}, now: Date = new Date()) {
    const scope = centreScope(user);
    if (range.from !== undefined) day(range.from, 'from');
    if (range.to !== undefined) day(range.to, 'to');

    return this.tenancy.withTenant(scope, async (tx) => {
      if (user.role === 'PARENT' && (await parentChildRooms(tx, user, scope, now)).length === 0) {
        throw new ForbiddenException('No child of yours is enrolled at this centre');
      }
      const centre = await tx.centre.findFirst({ where: { id: scope.centreId }, select: { timezone: true } });
      const today = centreDateString(centre?.timezone ?? 'Australia/Sydney', now);
      // Default: the current Monday to Sunday week.
      const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
      const from = range.from ?? (range.to ? addDaysToDate(range.to, -6) : addDaysToDate(today, -weekday));
      const to = range.to ?? addDaysToDate(from, 6);
      if (to < from) throw new BadRequestException('to must not be before from');
      if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 > MAX_RANGE_DAYS) {
        throw new BadRequestException(`The range can be at most ${MAX_RANGE_DAYS} days`);
      }
      const rows = await tx.menuItem.findMany({ where: { centreId: scope.centreId, date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } } });
      return rows.sort((a, b) => a.date.getTime() - b.date.getTime() || MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal)).map(present);
    });
  }

  async set(admin: RequestUser, date: string, mealKey: string, dto: { description?: string; allergenNotes?: string | null }, now: Date = new Date()) {
    const scope = assertAdmin(admin, 'change the menu');
    const d = day(date, 'Date');
    const m = meal(mealKey);
    const description = typeof dto.description === 'string' ? dto.description.trim() : '';
    if (description.length < 1 || description.length > 500) throw new BadRequestException('Description must be 1 to 500 characters');
    const allergenNotes = dto.allergenNotes == null ? null : String(dto.allergenNotes).trim() || null;
    if (allergenNotes && allergenNotes.length > 500) throw new BadRequestException('Allergen notes must be at most 500 characters');

    return this.tenancy.withTenant(scope, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('menu'), hashtext(${`${scope.centreId}|${d}|${m}`}))`;
      const when = new Date(`${d}T00:00:00Z`);
      const row = await tx.menuItem.upsert({
        where: { centreId_date_meal: { centreId: scope.centreId, date: when, meal: m } },
        create: { ...scope, date: when, meal: m, description, allergenNotes, updatedByUserId: admin.userId, updatedAt: now },
        update: { description, allergenNotes, updatedByUserId: admin.userId, updatedAt: now },
      });
      await this.record(tx, admin, scope, 'menu.set', row.id, m);
      return present(row);
    });
  }

  async clear(admin: RequestUser, date: string, mealKey: string, now: Date = new Date()) {
    void now;
    const scope = assertAdmin(admin, 'change the menu');
    const d = day(date, 'Date');
    const m = meal(mealKey);
    return this.tenancy.withTenant(scope, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('menu'), hashtext(${`${scope.centreId}|${d}|${m}`}))`;
      const existing = await tx.menuItem.findFirst({ where: { centreId: scope.centreId, date: new Date(`${d}T00:00:00Z`), meal: m } });
      if (!existing) throw new NotFoundException('Nothing is set for that meal');
      await tx.menuItem.delete({ where: { id: existing.id } });
      await this.record(tx, admin, scope, 'menu.cleared', existing.id, m);
      return { id: existing.id, cleared: true };
    });
  }
}
