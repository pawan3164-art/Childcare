import { Injectable } from '@nestjs/common';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { RequestUser } from '../authorization/request-user.interface';

const dayString = (d: Date) => d.toISOString().slice(0, 10);

export interface MyDataExport {
  generatedAt: string;
  profile: { id: string; email: string; firstName: string; lastName: string; role: string };
  children: {
    id: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    roomName: string | null;
    relationship: { relationshipType: string; canViewMedia: boolean; canViewBilling: boolean; canPickup: boolean };
    attendance: { eventType: string; timestamp: string }[];
    careRecords: { type: string; timestamp: string; note: string | null }[];
    absences: { date: string; isAllowable: boolean; reason: string | null }[];
    casualDayRequests: { date: string; status: string; note: string | null }[];
    pickupNominations: { date: string; personName: string; personPhone: string | null; status: string; verified: boolean }[];
  }[];
}

/**
 * Access to personal information (APP 12): a person can download what the platform
 * holds about them and their children. Each field is chosen by name, so credentials,
 * other guardians, other families, billing amounts and audit entries cannot slip in.
 * Staff receive only their own profile.
 */
@Injectable()
export class PrivacyService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    // Kept for symmetry with the other services and for future correction (APP 13) flows.
    private readonly authorization: AuthorizationService,
  ) {}

  async exportMyData(user: RequestUser, now: Date = new Date()): Promise<MyDataExport> {
    const ctx = { orgId: user.orgId as string, centreId: user.centreId };
    const data = await this.tenancy.withTenant(ctx, async (tx) => {
      const me = await tx.user.findUniqueOrThrow({ where: { id: user.userId }, select: { id: true, email: true, firstName: true, lastName: true, role: true } });
      if (user.role !== 'PARENT') return { me, children: [] as MyDataExport['children'] };

      const links = await tx.guardianChildRelationship.findMany({
        where: { guardianUserId: user.userId, isRestricted: false, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        include: { child: { include: { room: { select: { name: true } } } } },
        orderBy: { createdAt: 'asc' },
      });

      const children: MyDataExport['children'] = [];
      for (const link of links) {
        const childId = link.childId;
        const [attendance, careRecords, absences, requests, nominations] = await Promise.all([
          tx.attendanceEvent.findMany({ where: { childId }, orderBy: { timestamp: 'asc' }, select: { eventType: true, timestamp: true } }),
          tx.careRecord.findMany({ where: { childId }, orderBy: { timestamp: 'asc' }, select: { type: true, timestamp: true, note: true } }),
          tx.absence.findMany({ where: { childId }, orderBy: { date: 'asc' }, select: { date: true, isAllowable: true, reason: true } }),
          tx.casualDayRequest.findMany({ where: { childId }, orderBy: { date: 'asc' }, select: { date: true, status: true, note: true } }),
          tx.pickupNomination.findMany({ where: { childId }, orderBy: { date: 'asc' }, select: { date: true, personName: true, personPhone: true, status: true, verifiedAt: true } }),
        ]);
        children.push({
          id: link.child.id,
          firstName: link.child.firstName,
          lastName: link.child.lastName,
          dateOfBirth: dayString(link.child.dateOfBirth),
          roomName: link.child.room?.name ?? null,
          relationship: { relationshipType: link.relationshipType, canViewMedia: link.canViewMedia, canViewBilling: link.canViewBilling, canPickup: link.canPickup },
          attendance: attendance.map((a) => ({ eventType: a.eventType, timestamp: a.timestamp.toISOString() })),
          careRecords: careRecords.map((c) => ({ type: c.type, timestamp: c.timestamp.toISOString(), note: c.note })),
          absences: absences.map((a) => ({ date: dayString(a.date), isAllowable: a.isAllowable, reason: a.reason })),
          casualDayRequests: requests.map((r) => ({ date: dayString(r.date), status: r.status, note: r.note })),
          pickupNominations: nominations.map((n) => ({ date: dayString(n.date), personName: n.personName, personPhone: n.personPhone, status: n.status, verified: n.verifiedAt !== null })),
        });
      }
      return { me, children };
    });

    await this.audit.record({
      orgId: ctx.orgId,
      centreId: user.centreId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'privacy.export',
      entityType: 'User',
      entityId: user.userId,
      outcome: 'SUCCESS',
      metadata: { children: data.children.length },
    });
    return {
      generatedAt: now.toISOString(),
      profile: { id: data.me.id, email: data.me.email, firstName: data.me.firstName, lastName: data.me.lastName, role: data.me.role },
      children: data.children,
    };
  }
}
