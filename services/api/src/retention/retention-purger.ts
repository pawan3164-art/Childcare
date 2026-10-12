import { PrismaClient } from '@prisma/client';
import { ObjectStorage } from '../media/storage/object-storage';
import { AUTOMATED_TYPES, CONTENT_TYPES, eligibleOn, localDate, NOT_AUTOMATED_TYPES, RecordType } from './retention-rules';

export interface PurgeReport {
  dryRun: boolean;
  /** Only types that affected something; a zero is left out. */
  results: { childId: string; recordType: RecordType; affected: number }[];
  /** Types this version never deletes (they need manual review). */
  notAutomated: RecordType[];
}

const dayString = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The ONLY code that deletes retained records (BRD v2.3 §36.3, RET-002).
 *
 * It needs the schema-owner database connection: the web API's role has no
 * DELETE on these tables, so a bug or an attacker in the API cannot purge. Run it
 * as a scheduled maintenance job (see scripts/retention-purge.ts). The default is
 * a dry run that changes nothing.
 *
 * What it does for a departed child past retention, on its own rules and in the
 * centre's timezone: deletes attendance, care records and direct messages; deletes
 * photos only when every child tagged in them is also eligible (otherwise it just
 * removes this child's tag); then anonymises the child record, which stays because
 * billing and audit rows point at it. Allergy, immunisation and signed-form
 * records go with it (submissions and signatures need the maintenance role). Medication, learning, billing,
 * incidents and audit logs are never touched by this version. Children on legal hold or not yet
 * due are skipped. Audit entries carry the record type and a count, nothing else.
 */
export class RetentionPurger {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage?: ObjectStorage,
  ) {}

  async run(now: Date = new Date(), opts: { execute?: boolean; orgId?: string } = {}): Promise<PurgeReport> {
    const execute = opts.execute === true;
    const report: PurgeReport = { dryRun: !execute, results: [], notAutomated: [...NOT_AUTOMATED_TYPES] };

    const children = await this.prisma.child.findMany({
      where: { departedOn: { not: null }, legalHold: false, anonymisedAt: null, ...(opts.orgId ? { orgId: opts.orgId } : {}) },
      orderBy: { id: 'asc' },
    });
    if (children.length === 0) return report;

    const centreIds = [...new Set(children.map((c) => c.centreId))];
    const centres = new Map((await this.prisma.centre.findMany({ where: { id: { in: centreIds } }, select: { id: true, timezone: true } })).map((c) => [c.id, c.timezone]));
    const overrideRows = await this.prisma.centreRetentionOverride.findMany({ where: { centreId: { in: centreIds } } });
    const overrides = new Map<string, number>(overrideRows.map((o) => [`${o.centreId}|${o.recordType}`, o.years]));

    const eligible = (child: (typeof children)[number], type: RecordType): boolean => {
      const today = localDate(centres.get(child.centreId) ?? 'Australia/Sydney', now);
      return eligibleOn(type, dayString(child.departedOn as Date), dayString(child.dateOfBirth), overrides.get(`${child.centreId}|${type}`)) <= today;
    };

    for (const child of children) {
      const due = new Set(AUTOMATED_TYPES.filter((t) => eligible(child, t)));
      if (due.size === 0) continue;
      let incomplete = false;

      const note = async (recordType: RecordType, affected: number) => {
        if (affected <= 0) return;
        report.results.push({ childId: child.id, recordType, affected });
        if (!execute) return;
        await this.prisma.auditLogEntry.create({
          data: {
            orgId: child.orgId,
            centreId: child.centreId,
            actorUserId: null,
            actorRole: null,
            action: 'retention.purged',
            entityType: 'Child',
            entityId: child.id,
            outcome: 'SUCCESS',
            metadata: { recordType, affected },
          },
        });
      };

      if (due.has('attendance')) {
        const where = { childId: child.id };
        await note('attendance', execute ? (await this.prisma.attendanceEvent.deleteMany({ where })).count : await this.prisma.attendanceEvent.count({ where }));
      }
      if (due.has('care_records')) {
        const where = { childId: child.id };
        await note('care_records', execute ? (await this.prisma.careRecord.deleteMany({ where })).count : await this.prisma.careRecord.count({ where }));
      }
      if (due.has('messages')) {
        const threads = await this.prisma.directThread.findMany({ where: { childId: child.id }, select: { id: true } });
        const threadIds = threads.map((t) => t.id);
        const messages = await this.prisma.directMessage.count({ where: { threadId: { in: threadIds } } });
        if (execute && threadIds.length > 0) {
          await this.prisma.directMessage.deleteMany({ where: { threadId: { in: threadIds } } });
          await this.prisma.directThread.deleteMany({ where: { id: { in: threadIds } } });
        }
        await note('messages', threads.length + messages);
      }
      if (due.has('media')) {
        const result = await this.purgeMedia(child.id, execute, (other) => {
          const row = children.find((c) => c.id === other);
          return !!row && eligible(row, 'media');
        });
        if (result.failed > 0) incomplete = true;
        await note('media', result.affected);
      }

      if (due.has('health')) {
        const where = { childId: child.id };
        const count = execute
          ? (await this.prisma.childAllergy.deleteMany({ where })).count +
            (await this.prisma.childImmunisation.deleteMany({ where })).count +
            (await this.prisma.childImmunisationStatus.deleteMany({ where })).count
          : (await this.prisma.childAllergy.count({ where })) +
            (await this.prisma.childImmunisation.count({ where })) +
            (await this.prisma.childImmunisationStatus.count({ where }));
        await note('health', count);
      }
      if (due.has('forms')) {
        const requests = await this.prisma.formRequest.findMany({ where: { childId: child.id }, select: { id: true } });
        const requestIds = requests.map((r) => r.id);
        const submissionWhere = { childId: child.id };
        const signatureWhere = { requestId: { in: requestIds } };
        let count: number;
        if (execute) {
          // Submissions and signatures hang off requests, so they go first. The delete is allowed by the
          // database only for the maintenance role (the immutability trigger still blocks the web API).
          count =
            (await this.prisma.formSubmission.deleteMany({ where: submissionWhere })).count +
            (requestIds.length ? (await this.prisma.formSignature.deleteMany({ where: signatureWhere })).count : 0) +
            (await this.prisma.formRequest.deleteMany({ where: { childId: child.id } })).count;
        } else {
          count =
            (await this.prisma.formSubmission.count({ where: submissionWhere })) +
            (requestIds.length ? await this.prisma.formSignature.count({ where: signatureWhere }) : 0) +
            requests.length;
        }
        await note('forms', count);
      }

      // The child shell is only anonymised once none of its content is still inside its own period or failed to delete.
      if (due.has('enrolment') && CONTENT_TYPES.every((t) => due.has(t)) && !incomplete) {
        const where = { childId: child.id };
        const relationships = execute ? 0 : await this.prisma.guardianChildRelationship.count({ where });
        const pickups = execute ? 0 : await this.prisma.pickupNomination.count({ where });
        const casuals = execute ? 0 : await this.prisma.casualDayRequest.count({ where });
        let affected = relationships + pickups + casuals + 1;
        if (execute) {
          const deleted =
            (await this.prisma.guardianChildRelationship.deleteMany({ where })).count +
            (await this.prisma.pickupNomination.deleteMany({ where })).count +
            (await this.prisma.casualDayRequest.deleteMany({ where })).count;
          await this.prisma.child.update({
            where: { id: child.id },
            data: {
              firstName: 'Former',
              lastName: 'child',
              dateOfBirth: new Date(Date.UTC(child.dateOfBirth.getUTCFullYear(), 0, 1)),
              legalHoldReason: null,
              roomId: null,
              anonymisedAt: now,
            },
          });
          affected = deleted + 1;
        }
        await note('enrolment', affected);
      }
    }
    return report;
  }

  /**
   * Photos tagged to this child. An asset goes entirely (object, tags, row) only when every
   * child tagged in it is also due; otherwise only this child's tag is removed. The stored
   * object is deleted before the database rows, so a storage failure leaves everything in
   * place for the next run to retry.
   */
  private async purgeMedia(childId: string, execute: boolean, isDue: (childId: string) => boolean): Promise<{ affected: number; failed: number }> {
    const tags = await this.prisma.mediaAssetChildTag.findMany({ where: { childId }, select: { mediaAssetId: true } });
    let affected = 0;
    let failed = 0;
    for (const { mediaAssetId } of tags) {
      const asset = await this.prisma.mediaAsset.findUnique({ where: { id: mediaAssetId }, include: { childTags: { select: { childId: true } } } });
      if (!asset) continue;
      const allDue = asset.childTags.every((t) => t.childId === childId || isDue(t.childId));
      if (allDue) {
        if (execute) {
          if (!this.storage) {
            failed++;
            continue;
          }
          try {
            await this.storage.delete(asset.storageKey);
          } catch {
            failed++;
            continue;
          }
          await this.prisma.mediaAssetChildTag.deleteMany({ where: { mediaAssetId } });
          await this.prisma.mediaAsset.delete({ where: { id: mediaAssetId } });
        }
      } else if (execute) {
        await this.prisma.mediaAssetChildTag.deleteMany({ where: { mediaAssetId, childId } });
      }
      affected++;
    }
    return { affected, failed };
  }
}
