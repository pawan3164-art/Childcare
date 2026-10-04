import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AdministrationStatus, MedicationAdministration, MedicationAuthorization } from '@prisma/client';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService, STAFF_ROLES } from '../authorization/authorization.service';
import { RequestUser } from '../authorization/request-user.interface';
import { CreateAuthorizationDto } from './dto/create-authorization.dto';
import { RecordAdministrationDto } from './dto/record-administration.dto';

const ADMIN_ROLES = ['CENTRE_ADMIN', 'ORG_ADMIN', 'PLATFORM_ADMIN'];

/** Delivery Plan §6.1: the duplicate-administration lookback window that
 * triggers the hard-conflict path. Deliberately generous (double-dose risk
 * is a safety issue, not a UX one) — tune later against real med schedules. */
const DUPLICATE_WINDOW_HOURS = 4;

/**
 * BRD §14 / Delivery Plan §6.1: "medication administration is a hard
 * conflict needing human review (double-dose risk)." Unlike attendance
 * (server-wins) or care records (plain append), a second administration
 * against the same authorization within the window is NOT silently applied —
 * it's stored as PENDING_REVIEW and must be explicitly confirmed or rejected
 * by an administrator before it counts as a confirmed record.
 */
@Injectable()
export class MedicationService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
  ) {}

  async authorize(user: RequestUser, dto: CreateAuthorizationDto): Promise<MedicationAuthorization> {
    if (!user.orgId || !user.centreId) throw new ForbiddenException();
    await this.authorization.assertCanAccessChild(user, dto.childId, 'view');
    // A parent can only give consent in their own name; staff record a
    // consent given on paper/verbally by a named guardian.
    if (user.role === 'PARENT' && dto.authorizedByGuardianId !== user.userId) {
      throw new ForbiddenException('A parent can only authorize medication in their own name');
    }

    const authorization = await this.tenancy.withTenant(
      { orgId: user.orgId, centreId: user.centreId },
      async (tx) => {
        // BRD §14 / National Regulations r.92-93: consent must come from a
        // current, unrestricted parent or guardian of this child — never a
        // pickup-only contact, a staff member, or another family's parent.
        const rel = await tx.guardianChildRelationship.findUnique({
          where: { guardianUserId_childId: { guardianUserId: dto.authorizedByGuardianId, childId: dto.childId } },
          include: { guardian: { select: { role: true } } },
        });
        const valid =
          rel &&
          rel.guardian.role === 'PARENT' &&
          (rel.relationshipType === 'PARENT' || rel.relationshipType === 'GUARDIAN') &&
          !rel.isRestricted &&
          (!rel.expiresAt || rel.expiresAt.getTime() > Date.now());
        if (!valid) {
          throw new BadRequestException('authorizedByGuardianId must be a current parent or guardian of this child');
        }
        return tx.medicationAuthorization.create({
          data: {
            orgId: user.orgId as string,
            centreId: user.centreId as string,
            childId: dto.childId,
            medicationName: dto.medicationName,
            dosageInstructions: dto.dosageInstructions,
            authorizedByGuardianId: dto.authorizedByGuardianId,
            expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          },
        });
      },
    );

    await this.audit.record({
      orgId: user.orgId,
      centreId: user.centreId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'medication.authorize',
      entityType: 'MedicationAuthorization',
      entityId: authorization.id,
      outcome: 'SUCCESS',
    });

    return authorization;
  }

  async recordAdministration(
    user: RequestUser,
    dto: RecordAdministrationDto,
  ): Promise<MedicationAdministration> {
    if (!user.orgId || !user.centreId) throw new ForbiddenException();
    await this.authorization.assertRole(user, STAFF_ROLES, 'medication.administer');

    const administeredAt = new Date(dto.administeredAt);
    const windowStart = new Date(administeredAt.getTime() - DUPLICATE_WINDOW_HOURS * 60 * 60 * 1000);
    const windowEnd = new Date(administeredAt.getTime() + DUPLICATE_WINDOW_HOURS * 60 * 60 * 1000);

    const administration = await this.tenancy.withTenant(
      { orgId: user.orgId, centreId: user.centreId },
      async (tx) => {
        const auth = await tx.medicationAuthorization.findUniqueOrThrow({
          where: { id: dto.authorizationId },
        });
        await this.authorization.assertCanAccessChild(user, auth.childId, 'view');

        const existingNearby = await tx.medicationAdministration.findFirst({
          where: {
            authorizationId: dto.authorizationId,
            status: { not: 'REJECTED' },
            administeredAt: { gte: windowStart, lte: windowEnd },
          },
        });

        const status: AdministrationStatus = existingNearby ? 'PENDING_REVIEW' : 'CONFIRMED';

        return tx.medicationAdministration.create({
          data: {
            orgId: user.orgId as string,
            centreId: user.centreId as string,
            authorizationId: dto.authorizationId,
            administeredByUserId: user.userId,
            administeredAt,
            dosageGiven: dto.dosageGiven,
            notes: dto.notes ?? null,
            status,
          },
        });
      },
    );

    await this.audit.record({
      orgId: user.orgId,
      centreId: user.centreId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'medication.administer',
      entityType: 'MedicationAdministration',
      entityId: administration.id,
      outcome: 'SUCCESS',
      metadata: { status: administration.status, authorizationId: dto.authorizationId },
    });

    return administration;
  }

  async review(
    user: RequestUser,
    administrationId: string,
    decision: 'CONFIRMED' | 'REJECTED',
    notes?: string,
  ): Promise<MedicationAdministration> {
    if (!user.orgId || !user.centreId) throw new ForbiddenException();
    if (!ADMIN_ROLES.includes(user.role)) {
      throw new ForbiddenException('Only an administrator can resolve a medication administration conflict');
    }

    const resolved = await this.tenancy.withTenant(
      { orgId: user.orgId, centreId: user.centreId },
      async (tx) => {
        // RLS only isolates by org: confine review to the admin's own centre,
        // and only to administrations actually awaiting a decision — a
        // CONFIRMED or REJECTED dose is settled history, not re-decidable.
        const existing = await tx.medicationAdministration.findFirst({
          where: { id: administrationId, centreId: user.centreId as string },
          select: { status: true },
        });
        if (!existing) throw new NotFoundException('Medication administration not found');
        if (existing.status !== 'PENDING_REVIEW') {
          throw new ConflictException('Only an administration pending review can be resolved');
        }
        return tx.medicationAdministration.update({
          where: { id: administrationId },
          data: { status: decision, reviewedByUserId: user.userId, reviewedAt: new Date() },
        });
      },
    );

    await this.audit.record({
      orgId: user.orgId,
      centreId: user.centreId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'medication.review',
      entityType: 'MedicationAdministration',
      entityId: administrationId,
      outcome: 'SUCCESS',
      metadata: { decision, notes },
    });

    return resolved;
  }

  /**
   * Staff administration list, optionally filtered to the pending-review queue.
   * Admins see the centre; educators only children in their assigned rooms.
   * Parents never use this (it spans families) — they read their own child's
   * authorizations via listAuthorizationsForChild.
   */
  async listAdministrations(user: RequestUser, status?: 'PENDING_REVIEW' | 'CONFIRMED' | 'REJECTED') {
    if (!user.orgId || !user.centreId) throw new ForbiddenException();
    await this.authorization.assertRole(user, STAFF_ROLES, 'medication.list_administrations');
    const roomFilter =
      user.role === 'EDUCATOR'
        ? { authorization: { child: { roomId: { in: await this.authorization.activeRoomIds(user) } } } }
        : {};

    const list = await this.tenancy.withTenant({ orgId: user.orgId, centreId: user.centreId }, (tx) =>
      tx.medicationAdministration.findMany({
        where: { centreId: user.centreId as string, ...roomFilter, ...(status ? { status } : {}) },
        include: {
          authorization: {
            select: { medicationName: true, child: { select: { firstName: true, lastName: true } } },
          },
        },
        orderBy: { administeredAt: 'desc' },
        take: 100,
      }),
    );

    // Health information read (BRD §18): record who viewed the list.
    await this.audit.record({
      orgId: user.orgId,
      centreId: user.centreId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'medication.list_administrations',
      entityType: 'MedicationAdministration',
      outcome: 'SUCCESS',
      metadata: { status: status ?? null, count: list.length },
    });

    return list;
  }

  /** Standing authorizations for a child (e.g. to populate the "administer" form's dropdown). */
  async listAuthorizationsForChild(user: RequestUser, childId: string) {
    if (!user.orgId || !user.centreId) throw new ForbiddenException();
    await this.authorization.assertCanAccessChild(user, childId, 'view');

    return this.tenancy.withTenant({ orgId: user.orgId, centreId: user.centreId }, (tx) =>
      tx.medicationAuthorization.findMany({ where: { childId }, orderBy: { createdAt: 'desc' } }),
    );
  }
}
