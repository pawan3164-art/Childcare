import { ForbiddenException, Injectable } from '@nestjs/common';
import { Incident } from '@prisma/client';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService, STAFF_ROLES } from '../authorization/authorization.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RequestUser } from '../authorization/request-user.interface';
import { CreateIncidentDto } from './dto/create-incident.dto';

const ADMIN_ROLES = ['CENTRE_ADMIN', 'ORG_ADMIN', 'PLATFORM_ADMIN'];

/**
 * BRD §14 / §22: incident records are immutable once created (no UPDATE grant
 * on the core fields — see the Stage 2 RLS migration's column-level grants).
 * Review decisions append to reviewStatus/reviewedBy/reviewedAt/reviewNotes,
 * which DO have an UPDATE grant, but the original description/severity/
 * occurredAt/childId can never change — a correction would be a new linked
 * incident, not implemented here but following the same correctedEventId
 * pattern as attendance.
 */
@Injectable()
export class IncidentsService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(user: RequestUser, dto: CreateIncidentDto): Promise<Incident> {
    if (!user.orgId || !user.centreId) throw new ForbiddenException();
    await this.authorization.assertRole(user, STAFF_ROLES, 'incident.create');
    await this.authorization.assertCanAccessChild(user, dto.childId, 'view');

    const { incident, guardianUserIds } = await this.tenancy.withTenant(
      { orgId: user.orgId, centreId: user.centreId },
      async (tx) => {
        const created = await tx.incident.create({
          data: {
            orgId: user.orgId as string,
            centreId: user.centreId as string,
            childId: dto.childId,
            severity: dto.severity,
            description: dto.description,
            occurredAt: new Date(dto.occurredAt),
            reportedByUserId: user.userId,
          },
        });

        const relationships = await tx.guardianChildRelationship.findMany({
          where: { childId: dto.childId, isRestricted: false },
        });

        return { incident: created, guardianUserIds: relationships.map((r) => r.guardianUserId) };
      },
    );

    // BRD §16: incidents are always URGENT priority, regardless of severity —
    // a parent should never have to guess whether "minor" means "ignorable."
    for (const guardianUserId of guardianUserIds) {
      await this.notifications.enqueue({
        orgId: user.orgId,
        centreId: user.centreId,
        recipientUserId: guardianUserId,
        priority: 'URGENT',
        channel: 'PUSH',
        payload: { type: 'incident', incidentId: incident.id, childId: dto.childId, severity: dto.severity },
      });
    }

    await this.audit.record({
      orgId: user.orgId,
      centreId: user.centreId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'incident.create',
      entityType: 'Incident',
      entityId: incident.id,
      outcome: 'SUCCESS',
      metadata: { severity: dto.severity, notifiedGuardians: guardianUserIds.length },
    });

    return incident;
  }

  async acknowledge(user: RequestUser, incidentId: string): Promise<void> {
    if (!user.orgId || !user.centreId) throw new ForbiddenException();

    await this.tenancy.withTenant({ orgId: user.orgId, centreId: user.centreId }, async (tx) => {
      const incident = await tx.incident.findUniqueOrThrow({ where: { id: incidentId } });
      await this.authorization.assertCanAccessChild(user, incident.childId, 'view');

      await tx.incidentAcknowledgement.upsert({
        where: { incidentId_guardianUserId: { incidentId, guardianUserId: user.userId } },
        create: { orgId: user.orgId as string, incidentId, guardianUserId: user.userId },
        update: {},
      });
    });

    await this.audit.record({
      orgId: user.orgId,
      centreId: user.centreId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'incident.acknowledge',
      entityType: 'Incident',
      entityId: incidentId,
      outcome: 'SUCCESS',
    });
  }

  async review(user: RequestUser, incidentId: string, reviewNotes?: string): Promise<Incident> {
    if (!user.orgId || !user.centreId) throw new ForbiddenException();
    if (!ADMIN_ROLES.includes(user.role)) {
      throw new ForbiddenException('Only an administrator can review an incident');
    }

    const reviewed = await this.tenancy.withTenant(
      { orgId: user.orgId, centreId: user.centreId },
      (tx) =>
        tx.incident.update({
          where: { id: incidentId },
          data: {
            reviewStatus: 'REVIEWED',
            reviewedByUserId: user.userId,
            reviewedAt: new Date(),
            reviewNotes: reviewNotes ?? null,
          },
        }),
    );

    await this.audit.record({
      orgId: user.orgId,
      centreId: user.centreId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'incident.review',
      entityType: 'Incident',
      entityId: incidentId,
      outcome: 'SUCCESS',
    });

    return reviewed;
  }

  /** Centre-wide incident list for the portal's incidents screen. */
  async list(user: RequestUser) {
    if (!user.orgId || !user.centreId) throw new ForbiddenException();
    if (!ADMIN_ROLES.includes(user.role) && user.role !== 'EDUCATOR') throw new ForbiddenException();

    return this.tenancy.withTenant({ orgId: user.orgId, centreId: user.centreId }, (tx) =>
      tx.incident.findMany({
        where: { centreId: user.centreId as string },
        include: { child: { select: { firstName: true, lastName: true } } },
        orderBy: { occurredAt: 'desc' },
        take: 100,
      }),
    );
  }
}
