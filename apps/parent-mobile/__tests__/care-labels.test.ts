import { CARE_TYPE_LABEL, describeCareRecord } from '@/lib/care-labels';

describe('CARE_TYPE_LABEL', () => {
  it('labels every care record type', () => {
    expect(CARE_TYPE_LABEL).toEqual({
      MEAL: 'Meal',
      SLEEP: 'Sleep',
      TOILETING: 'Toileting',
      BOTTLE: 'Bottle',
      ACTIVITY: 'Activity',
      NAPPY: 'Nappy change',
      SUNSCREEN: 'Sunscreen applied',
      SLEEP_CHECK: 'Sleep check',
    });
  });
});

describe('describeCareRecord', () => {
  it.each([
    ['MEAL', 'Meal'],
    ['TOILETING', 'Toileting'],
    ['BOTTLE', 'Bottle'],
    ['ACTIVITY', 'Activity'],
    ['SUNSCREEN', 'Sunscreen applied'],
    ['SLEEP', 'Sleep'],
    ['NAPPY', 'Nappy change'],
    ['SLEEP_CHECK', 'Sleep check'],
  ] as const)('%s with null details is just the label', (type, label) => {
    expect(describeCareRecord(type, null)).toBe(label);
  });

  it('describes nappy condition lowercased', () => {
    expect(describeCareRecord('NAPPY', { condition: 'WET' })).toBe('Nappy change: wet');
    expect(describeCareRecord('NAPPY', { condition: 'Dirty' })).toBe('Nappy change: dirty');
  });
  it('falls back to the label for nappy without a string condition', () => {
    expect(describeCareRecord('NAPPY', {})).toBe('Nappy change');
    expect(describeCareRecord('NAPPY', { condition: 3 })).toBe('Nappy change');
  });
  it('describes sleep start and end', () => {
    expect(describeCareRecord('SLEEP', { phase: 'START' })).toBe('Fell asleep');
    expect(describeCareRecord('SLEEP', { phase: 'END' })).toBe('Woke up');
  });
  it('falls back to the label for unknown sleep phase', () => expect(describeCareRecord('SLEEP', { phase: 'X' })).toBe('Sleep'));
  it('describes sleep checks by position and breathing', () => {
    expect(describeCareRecord('SLEEP_CHECK', { position: 'BACK', breathingOk: true })).toBe('Sleep check: on back, breathing normally');
    expect(describeCareRecord('SLEEP_CHECK', { position: 'SIDE', breathingOk: true })).toBe('Sleep check: on side, breathing normally');
    expect(describeCareRecord('SLEEP_CHECK', { position: 'FRONT', breathingOk: false })).toBe('Sleep check: on front, breathing concern');
  });
  it('handles an unknown sleep check position', () => {
    expect(describeCareRecord('SLEEP_CHECK', { position: 'UPSIDE', breathingOk: true })).toBe('Sleep check: , breathing normally');
  });
  it('ignores unknown details on other types', () => {
    expect(describeCareRecord('MEAL', { foo: 'bar' })).toBe('Meal');
    expect(describeCareRecord('ACTIVITY', {})).toBe('Activity');
  });
  it('returns the raw type for an unknown type', () => {
    expect(describeCareRecord('WAT' as never, null)).toBe('WAT');
  });
});
