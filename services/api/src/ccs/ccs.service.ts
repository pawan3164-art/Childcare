import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CcsEnrolment, CcsSessionReport } from '@prisma/client';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { RequestUser } from '../authorization/request-user.interface';
import { CCS_GATEWAY, CcsGateway } from './gateway/ccs-gateway.interface';
import { CreateEnrolmentDto } from './dto/create-enrolment.dto';
import { SubmitSessionReportDto } from './dto/submit-session-report.dto';

const ADMIN_ROLES = ['CENTRE_ADMIN', 'ORG_ADMIN', 'PLATFORM_ADMIN'];

/**
 * BIL-004/BIL-005: submits session reports to the (mocked) CCS gateway and
 * turns an accepted response into a SUBSIDY_CONFIRMED ledger entry — plugging
 * directly into the estimated-vs-confirmed netting built in Stage 3
 * (ADR 0002) without any change to LedgerService. A rejected response is
 * recorded with its reason and can be replayed via resubmit(), which creates
 * a new attempt rather than editing the rejected one.
 */
@Injectable()
export class CcsService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
    @Inject(CCS_GATEWAY) private readonly gateway: CcsGateway,
  ) {}

  async createEnrolment(user: RequestUser, dto: CreateEnrolmentDto): Promise<CcsEnrolment> {
    if (!user.orgId || !user.centreId) throw new ForbiddenException();
    if (!ADMIN_ROLES.includes(user.role)) throw new ForbiddenException();
    await this.authorization.assertCanAccessChild(user, dto.childId, 'viewBilling');

    const enrolment = await this.tenancy.withTenant(
      { orgId: user.orgId, centreId: user.centreId },
      (tx) =>
        tx.ccsEnrolment.create({
          data: {
            orgId: user.orgId as string,
            centreId: user.centreId as string,
            childId: dto.childId,
            ccsEnrolmentRef: dto.ccsEnrolmentRef,
          },
        }),
    );

    await this.audit.record({
      orgId: user.orgId,
      centreId: user.centreId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'ccs.enrolment.create',
      entityType: 'CcsEnrolment',
      entityId: enrolment.id,
      outcome: 'SUCCESS',
    });

    return enrolment;
  }

  async submitSessionReport(user: RequestUser, dto: SubmitSessionReportDto): Promise<CcsSessionReport> {
    if (!user.orgId || !user.centreId) throw new ForbiddenException();
    if (!ADMIN_ROLES.includes(user.role)) throw new ForbiddenException();

    const sessionDate = new Date(dto.sessionDate);

    const report = await this.tenancy.withTenant(
      { orgId: user.orgId, centreId: user.centreId },
      async (tx) => {
        const enrolment = await tx.ccsEnrolment.findUniqueOrThrow({ where: { id: dto.enrolmentId } });
        await this.authorization.assertCanAccessChild(user, enrolment.childId, 'viewBilling');

        return tx.ccsSessionReport.create({
          data: {
            orgId: user.orgId as string,
            centreId: user.centreId as string,
            enrolmentId: dto.enrolmentId,
            sessionDate,
            hours: dto.hours,
            status: 'PENDING',
          },
        });
      },
    );

    return this.dispatchToGateway(user, report);
  }

  /** The "replay tool": re-attempts a rejected report as a new, numbered attempt. */
  async resubmit(user: RequestUser, rejectedReportId: string): Promise<CcsSessionReport> {
    if (!user.orgId || !user.centreId) throw new ForbiddenException();
    if (!ADMIN_ROLES.includes(user.role)) throw new ForbiddenException();

    const newAttempt = await this.tenancy.withTenant(
      { orgId: user.orgId, centreId: user.centreId },
      async (tx) => {
        const original = await tx.ccsSessionReport.findUniqueOrThrow({ where: { id: rejectedReportId } });
        if (original.status !== 'REJECTED') {
          throw new ForbiddenException('Only a rejected session report can be resubmitted');
        }
        const enrolment = await tx.ccsEnrolment.findUniqueOrThrow({ where: { id: original.enrolmentId } });
        await this.authorization.assertCanAccessChild(user, enrolment.childId, 'viewBilling');

        return tx.ccsSessionReport.create({
          data: {
            orgId: user.orgId as string,
            centreId: user.centreId as string,
            enrolmentId: original.enrolmentId,
            sessionDate: original.sessionDate,
            hours: original.hours,
            attemptNumber: original.attemptNumber + 1,
            status: 'PENDING',
          },
        });
      },
    );

    return this.dispatchToGateway(user, newAttempt);
  }

  private async dispatchToGateway(user: RequestUser, report: CcsSessionReport): Promise<CcsSessionReport> {
    const orgId = user.orgId as string;
    const centreId = user.centreId as string;

    const enrolment = await this.tenancy.withTenant({ orgId, centreId }, (tx) =>
      tx.ccsEnrolment.findUniqueOrThrow({ where: { id: report.enrolmentId } }),
    );

    const response = await this.gateway.submitSessionReport({
      ccsEnrolmentRef: enrolment.ccsEnrolmentRef,
      sessionDate: report.sessionDate,
      hours: report.hours,
    });

    const resolved = await this.tenancy.withTenant({ orgId, centreId }, async (tx) => {
      if (!response.accepted) {
        return tx.ccsSessionReport.update({
          where: { id: report.id },
          data: {
            status: 'REJECTED',
            rejectionReason: response.rejectionReason,
            providerResponseRef: response.providerResponseRef,
            resolvedAt: new Date(),
          },
        });
      }

      // Every amount carries its source (BRD §15): find the FEE entry for
      // this exact session and link the confirmed subsidy to it via
      // sourceFeeEntryId, the same mechanism Stage 3 already nets on.
      const feeEntry = await tx.ledgerEntry.findFirst({
        where: { childId: enrolment.childId, entryType: 'FEE', sessionDate: report.sessionDate },
      });
      if (!feeEntry) {
        throw new NotFoundException(
          `No FEE ledger entry found for child ${enrolment.childId} on ${report.sessionDate.toISOString().slice(0, 10)} — cannot confirm a subsidy against a session that wasn't invoiced`,
        );
      }

      const confirmedSubsidyCents = Math.floor(
        (feeEntry.amountCents * (response.confirmedSubsidyPercent ?? 0)) / 100,
      );

      const ledgerEntry = await tx.ledgerEntry.create({
        data: {
          orgId,
          centreId,
          childId: enrolment.childId,
          invoiceId: feeEntry.invoiceId,
          entryType: 'SUBSIDY_CONFIRMED',
          amountCents: -confirmedSubsidyCents,
          description: `Government-confirmed CCS subsidy (${response.confirmedSubsidyPercent}%), ref ${response.providerResponseRef}`,
          sessionDate: report.sessionDate,
          sourceFeeEntryId: feeEntry.id,
        },
      });

      return tx.ccsSessionReport.update({
        where: { id: report.id },
        data: {
          status: 'ACCEPTED',
          confirmedSubsidyCents,
          providerResponseRef: response.providerResponseRef,
          resolvedAt: new Date(),
          resultingLedgerEntryId: ledgerEntry.id,
        },
      });
    });

    await this.audit.record({
      orgId,
      centreId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'ccs.session_report.submit',
      entityType: 'CcsSessionReport',
      entityId: report.id,
      outcome: 'SUCCESS',
      metadata: { status: resolved.status, attemptNumber: report.attemptNumber },
    });

    return resolved;
  }
}
