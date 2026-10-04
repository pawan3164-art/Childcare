import { ForbiddenException, Injectable } from '@nestjs/common';
import { CareRecord } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService, STAFF_ROLES } from '../authorization/authorization.service';
import { RequestUser } from '../authorization/request-user.interface';
import { CreateGroupCareRecordDto } from './dto/create-group-care-record.dto';

export interface GroupCareRecordResult {
  groupEventId: string;
  records: CareRecord[];
  skipped: string[];
}

/**
 * BRD §9: one group action produces one append-only CareRecord per child,
 * sharing a groupEventId, instead of an educator re-entering the same event
 * for every child one at a time. Each child still gets an individual
 * authorization check — being in the submitted childIds list doesn't bypass
 * the educator's actual room assignment.
 */
@Injectable()
export class CareRecordsService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
  ) {}

  async createGroupEvent(
    user: RequestUser,
    dto: CreateGroupCareRecordDto,
  ): Promise<GroupCareRecordResult> {
    if (!user.orgId || !user.centreId) {
      throw new ForbiddenException('Care records require an authenticated staff user with centre context');
    }
    await this.authorization.assertRole(user, STAFF_ROLES, 'care_record.group_create');

    const groupEventId = uuidv4();
    const exceptionByChild = new Map((dto.exceptions ?? []).map((e) => [e.childId, e]));
    const skipped: string[] = [];
    const timestamp = new Date(dto.timestamp);

    const records = await this.tenancy.withTenant(
      { orgId: user.orgId, centreId: user.centreId },
      async (tx) => {
        const created: CareRecord[] = [];
        for (const childId of dto.childIds) {
          const exception = exceptionByChild.get(childId);
          if (exception?.skip) {
            skipped.push(childId);
            continue;
          }

          const allowed = await this.authorization.canAccessChild(user, childId, 'view');
          if (!allowed) {
            skipped.push(childId);
            continue;
          }

          created.push(
            await tx.careRecord.create({
              data: {
                orgId: user.orgId as string,
                centreId: user.centreId as string,
                childId,
                type: dto.type,
                timestamp,
                note: exception?.note ?? dto.defaultNote ?? null,
                groupEventId,
                recordedByUserId: user.userId,
              },
            }),
          );
        }
        return created;
      },
    );

    await this.audit.record({
      orgId: user.orgId,
      centreId: user.centreId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'care_record.group_create',
      entityType: 'CareRecord',
      entityId: groupEventId,
      outcome: 'SUCCESS',
      metadata: { type: dto.type, created: records.length, skipped },
    });

    return { groupEventId, records, skipped };
  }

  async history(user: RequestUser, childId: string): Promise<CareRecord[]> {
    if (!user.orgId) throw new ForbiddenException();
    await this.authorization.assertCanAccessChild(user, childId, 'view');

    return this.tenancy.withTenant({ orgId: user.orgId, centreId: user.centreId }, (tx) =>
      tx.careRecord.findMany({ where: { childId }, orderBy: { timestamp: 'desc' } }),
    );
  }
}
