import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface TenantContext {
  orgId: string;
  centreId?: string | null;
}

/**
 * The DB-enforced tenant boundary is org_id (row-level security, see
 * prisma/migrations/*_enable_rls). Centre/room/child-relationship access is
 * enforced in the application layer by AuthorizationService, because some
 * roles (Area/Enterprise Manager) legitimately span multiple centres within
 * one org — see BRD §3 and Delivery Plan §6.2.
 *
 * Every tenant-scoped query must run inside withTenant() so the RLS policy
 * has app.current_org_id to check against. There is no way to query
 * tenant-scoped tables through PrismaService directly without it — that's
 * deliberate: it should be impossible to "forget" the tenant filter.
 */
@Injectable()
export class TenancyService {
  constructor(private readonly prisma: PrismaService) {}

  async withTenant<T>(
    ctx: TenantContext,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_org_id', ${ctx.orgId}, true)`;
      await tx.$executeRaw`SELECT set_config('app.current_centre_id', ${ctx.centreId ?? ''}, true)`;
      return fn(tx);
    });
  }
}
