import { ForbiddenException, Injectable } from '@nestjs/common';
import { Invoice } from '@prisma/client';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { RequestUser } from '../authorization/request-user.interface';
import { FeeCalculationService } from './fee-calculation.service';
import { GenerateInvoiceDto } from './dto/generate-invoice.dto';

const ADMIN_ROLES = ['CENTRE_ADMIN', 'ORG_ADMIN', 'PLATFORM_ADMIN'];

export interface InvoiceSummary {
  invoice: Invoice;
  grossCents: number;
  estimatedSubsidyCents: number; // stored negative in the ledger; reported positive here for display
  gapCents: number;
  sessionCount: number;
}

/**
 * BIL-003/BIL-004/BIL-011: generates an invoice as an immutable header plus
 * append-only ledger entries (BRD §22: "issued invoices are immutable;
 * changes are made through credits/adjustments"). Every amount is tagged
 * FEE or SUBSIDY_ESTIMATED so the parent-facing breakdown can show gross,
 * subsidy and gap as explicitly separate, explainable numbers (PAR-009).
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
    private readonly feeCalculation: FeeCalculationService,
  ) {}

  async generateInvoice(user: RequestUser, dto: GenerateInvoiceDto): Promise<InvoiceSummary> {
    if (!user.orgId || !user.centreId) throw new ForbiddenException();
    if (!ADMIN_ROLES.includes(user.role)) {
      throw new ForbiddenException('Only an administrator can generate an invoice');
    }
    await this.authorization.assertCanAccessChild(user, dto.childId, 'view');

    const cycleStart = new Date(dto.cycleStart);
    const cycleEnd = new Date(dto.cycleEnd);

    const result = await this.tenancy.withTenant(
      { orgId: user.orgId, centreId: user.centreId },
      async (tx) => {
        const sessions = await this.feeCalculation.getChargeableSessions(tx, dto.childId, cycleStart, cycleEnd);

        const invoice = await tx.invoice.create({
          data: {
            orgId: user.orgId as string,
            centreId: user.centreId as string,
            childId: dto.childId,
            cycleStart,
            cycleEnd,
          },
        });

        let grossCents = 0;
        let estimatedSubsidyCents = 0;

        for (const session of sessions) {
          grossCents += session.grossCents;

          const feeEntry = await tx.ledgerEntry.create({
            data: {
              orgId: user.orgId as string,
              centreId: user.centreId as string,
              childId: dto.childId,
              invoiceId: invoice.id,
              entryType: 'FEE',
              amountCents: session.grossCents,
              description:
                session.siblingDiscountPercent > 0
                  ? `Session fee (${session.siblingDiscountPercent}% sibling discount applied)`
                  : 'Session fee',
              sessionDate: session.date,
              createdByUserId: user.userId,
            },
          });

          const entitlement = await tx.ccsEntitlement.findFirst({
            where: {
              childId: dto.childId,
              effectiveFrom: { lte: session.date },
              OR: [{ effectiveTo: null }, { effectiveTo: { gte: session.date } }],
            },
          });

          if (entitlement) {
            const subsidyCents = Math.floor((session.grossCents * entitlement.estimatedSubsidyPercent) / 100);
            if (subsidyCents > 0) {
              await tx.ledgerEntry.create({
                data: {
                  orgId: user.orgId as string,
                  centreId: user.centreId as string,
                  childId: dto.childId,
                  invoiceId: invoice.id,
                  entryType: 'SUBSIDY_ESTIMATED',
                  amountCents: -subsidyCents,
                  description: `Estimated CCS subsidy (${entitlement.estimatedSubsidyPercent}%) — platform estimate, not government-confirmed`,
                  sessionDate: session.date,
                  sourceFeeEntryId: feeEntry.id,
                  createdByUserId: user.userId,
                },
              });
              estimatedSubsidyCents += subsidyCents;
            }
          }
        }

        return { invoice, grossCents, estimatedSubsidyCents, sessionCount: sessions.length };
      },
    );

    await this.audit.record({
      orgId: user.orgId,
      centreId: user.centreId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'billing.invoice.generate',
      entityType: 'Invoice',
      entityId: result.invoice.id,
      outcome: 'SUCCESS',
      metadata: {
        childId: dto.childId,
        grossCents: result.grossCents,
        estimatedSubsidyCents: result.estimatedSubsidyCents,
        sessionCount: result.sessionCount,
      },
    });

    return {
      invoice: result.invoice,
      grossCents: result.grossCents,
      estimatedSubsidyCents: result.estimatedSubsidyCents,
      gapCents: result.grossCents - result.estimatedSubsidyCents,
      sessionCount: result.sessionCount,
    };
  }
}
