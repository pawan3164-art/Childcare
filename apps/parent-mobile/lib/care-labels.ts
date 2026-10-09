import type { CareRecordType } from './types';

export const CARE_TYPE_LABEL: Record<CareRecordType, string> = {
  MEAL: 'Meal',
  SLEEP: 'Sleep',
  TOILETING: 'Toileting',
  BOTTLE: 'Bottle',
  ACTIVITY: 'Activity',
  NAPPY: 'Nappy change',
  SUNSCREEN: 'Sunscreen applied',
  SLEEP_CHECK: 'Sleep check',
};

const POSITION: Record<string, string> = { BACK: 'on back', SIDE: 'on side', FRONT: 'on front' };

/** A short parent-readable line for a care record, e.g. "Nappy change: wet". */
export function describeCareRecord(type: CareRecordType, details: Record<string, unknown> | null): string {
  const label = CARE_TYPE_LABEL[type] ?? type;
  if (!details) return label;
  if (type === 'NAPPY' && typeof details.condition === 'string') return `${label}: ${details.condition.toLowerCase()}`;
  if (type === 'SLEEP' && details.phase === 'START') return 'Fell asleep';
  if (type === 'SLEEP' && details.phase === 'END') return 'Woke up';
  if (type === 'SLEEP_CHECK') {
    const pos = POSITION[String(details.position)] ?? '';
    return `${label}: ${pos}, ${details.breathingOk ? 'breathing normally' : 'breathing concern'}`;
  }
  return label;
}
