import { BadRequestException } from '@nestjs/common';
import { CareRecordType, Prisma } from '@prisma/client';

export const NAPPY_CONDITIONS = ['WET', 'SOILED', 'DRY'] as const;
export const SLEEP_PHASES = ['START', 'END'] as const;
export const SLEEP_POSITIONS = ['BACK', 'SIDE', 'FRONT'] as const;

/**
 * Validates and normalises the structured details for one care record. Used
 * by both the direct API and the offline sync path, so a record can't skip
 * validation by arriving through sync. Returns null when a type has none.
 */
export function validateCareDetails(type: CareRecordType, raw: unknown): Prisma.InputJsonObject | null {
  const d = (raw ?? {}) as Record<string, unknown>;
  if (typeof d !== 'object' || Array.isArray(d)) throw new BadRequestException('details must be an object');

  switch (type) {
    case 'NAPPY':
      if (!NAPPY_CONDITIONS.includes(d.condition as never)) {
        throw new BadRequestException(`NAPPY needs a condition: ${NAPPY_CONDITIONS.join(', ')}`);
      }
      return { condition: d.condition as string };

    case 'SLEEP':
      if (d.phase === undefined) return null;
      if (!SLEEP_PHASES.includes(d.phase as never)) throw new BadRequestException(`SLEEP phase must be ${SLEEP_PHASES.join(' or ')}`);
      return { phase: d.phase as string };

    case 'SLEEP_CHECK': {
      if (!SLEEP_POSITIONS.includes(d.position as never)) {
        throw new BadRequestException(`SLEEP_CHECK needs a position: ${SLEEP_POSITIONS.join(', ')}`);
      }
      if (typeof d.breathingOk !== 'boolean') throw new BadRequestException('SLEEP_CHECK needs breathingOk (true/false)');
      // Red Nose safe-sleep guidance: babies sleep on their back. Front
      // sleeping or abnormal breathing is flagged for immediate follow-up.
      const flagged = d.position === 'FRONT' || d.breathingOk === false;
      return { position: d.position as string, breathingOk: d.breathingOk, flagged };
    }

    default:
      return null;
  }
}
