import { ForbiddenException, Injectable } from '@nestjs/common';
import { LedgerEntry } from '@prisma/client';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { RequestUser } from '../authorization/request-user.interface';

export interface FamilyLedgerBreakdown {
  grossCents: number;
  subsidyCents: number; // net of estimated-vs-confirmed preference below, reported positive
  paymentsCents: number; // reported positive (total paid)
  adjustmentsCents: number; // signed, as entered
  creditsCents: number; // reported positive (total credited)
  balanceCents: number; // positive = owed by family, negative = credit in family's favour
}

/**
 * Delivery Plan §6.3: entries are "never overwritten" — balance is always
 * computed fresh from the full ledger, never read from a cached total field.
 * Where both a SUBSIDY_ESTIMATED and a later SUBSIDY_CONFIRMED entry exist
 * for the same FEE (via sourceFeeEntryId), CONFIRMED wins and the ESTIMATED
 * one is excluded — otherwise the family would be double-subsidized.
 */
@Injectable()
export class LedgerService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly authorization: AuthorizationService,
  ) {}

  async getBreakdown(user: RequestUser, childId: string): Promise<FamilyLedgerBreakdown> {
    if (!user.orgId) throw new ForbiddenException();
    await this.authorization.assertCanAccessChild(user, childId, 'viewBilling');

    const entries = await this.tenancy.withTenant({ orgId: user.orgId, centreId: user.centreId }, (tx) =>
      tx.ledgerEntry.findMany({ where: { childId } }),
    );

    return this.computeBreakdown(entries);
  }

  computeBreakdown(entries: LedgerEntry[]): FamilyLedgerBreakdown {
    const fees = entries.filter((e) => e.entryType === 'FEE');
    const subsidiesByFeeId = new Map<string, LedgerEntry[]>();
    for (const e of entries) {
      if (e.entryType === 'SUBSIDY_ESTIMATED' || e.entryType === 'SUBSIDY_CONFIRMED') {
        const key = e.sourceFeeEntryId ?? 'unlinked';
        subsidiesByFeeId.set(key, [...(subsidiesByFeeId.get(key) ?? []), e]);
      }
    }

    let grossCents = 0;
    let subsidyCents = 0;
    for (const fee of fees) {
      grossCents += fee.amountCents;
      const subsidyEntriesForFee = subsidiesByFeeId.get(fee.id) ?? [];
      const confirmed = subsidyEntriesForFee.find((s) => s.entryType === 'SUBSIDY_CONFIRMED');
      const chosen = confirmed ?? subsidyEntriesForFee.find((s) => s.entryType === 'SUBSIDY_ESTIMATED');
      if (chosen) subsidyCents += -chosen.amountCents; // stored negative, report positive
    }

    const paymentsCents = -entries.filter((e) => e.entryType === 'PAYMENT').reduce((sum, e) => sum + e.amountCents, 0);
    const creditsCents = -entries.filter((e) => e.entryType === 'CREDIT').reduce((sum, e) => sum + e.amountCents, 0);
    const adjustmentsCents = entries.filter((e) => e.entryType === 'ADJUSTMENT').reduce((sum, e) => sum + e.amountCents, 0);

    const balanceCents =
      grossCents - subsidyCents - paymentsCents - creditsCents + adjustmentsCents;

    return { grossCents, subsidyCents, paymentsCents, adjustmentsCents, creditsCents, balanceCents };
  }
}
