import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RequestUser } from '../authorization/request-user.interface';
import { CreateUserDto } from './dto/create-user.dto';

const ADMIN_ROLES = ['CENTRE_ADMIN', 'ORG_ADMIN', 'PLATFORM_ADMIN'];

/**
 * Staff/guardian account provisioning. Immediate password set, no
 * email-invitation flow yet (OI tracked in docs/open-items.md) — fine for a
 * centre admin setting up known staff/parent accounts directly.
 *
 * `users` is intentionally outside RLS (see ADR 0001), so this queries
 * PrismaService directly and scopes by orgId/centreId in application code
 * instead.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(user: RequestUser, dto: CreateUserDto) {
    if (!user.orgId) throw new ForbiddenException();
    if (!ADMIN_ROLES.includes(user.role)) throw new ForbiddenException('Only an administrator can create accounts');

    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('An account with this email already exists');

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const created = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        role: dto.role,
        firstName: dto.firstName,
        lastName: dto.lastName,
        // Every role, including PARENT, gets an orgId/centreId at creation —
        // TenancyService.withTenant needs it to set RLS context for ANY
        // tenant-scoped query the user makes, including a parent looking up
        // their own GuardianChildRelationship rows. A true multi-org parent
        // (children at centres under different organisations) isn't
        // supported by this single orgId yet — same class of known
        // simplification as CENTRE_ADMIN being single-centre (ADR 0001).
        orgId: user.orgId,
        centreId: user.centreId ?? null,
      },
    });

    await this.audit.record({
      orgId: user.orgId,
      centreId: user.centreId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'user.create',
      entityType: 'User',
      entityId: created.id,
      outcome: 'SUCCESS',
      metadata: { role: dto.role },
    });

    return { id: created.id, email: created.email, role: created.role, firstName: created.firstName, lastName: created.lastName };
  }

  /** For an admin picking a guardian to link when creating a relationship. */
  async listByRole(user: RequestUser, role: 'PARENT' | 'EDUCATOR' | 'CENTRE_ADMIN') {
    if (!user.orgId) throw new ForbiddenException();
    if (!ADMIN_ROLES.includes(user.role)) throw new ForbiddenException();

    const where = role === 'PARENT' ? { role } : { role, orgId: user.orgId };
    const users = await this.prisma.user.findMany({
      where,
      select: { id: true, email: true, firstName: true, lastName: true },
      orderBy: { firstName: 'asc' },
      take: 200,
    });
    return users;
  }
}
