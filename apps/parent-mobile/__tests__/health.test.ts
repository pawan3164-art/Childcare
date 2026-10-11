import {
  severityLabel,
  severityTone,
  sortAllergies,
  allergySummary,
  hasSeriousAllergy,
  sourceLabel,
  immunisationStatusLabel,
  formatDoseDate,
} from '@/lib/health';
import type { AllergyItem, Severity } from '@/lib/health';

const allergy = (allergen: string, severity: Severity, id = allergen): AllergyItem => ({
  id,
  allergen,
  severity,
  reaction: null,
  actionPlan: null,
});

describe('severityLabel', () => {
  it('labels MILD', () => expect(severityLabel('MILD')).toBe('Mild'));
  it('labels MODERATE', () => expect(severityLabel('MODERATE')).toBe('Moderate'));
  it('labels SEVERE', () => expect(severityLabel('SEVERE')).toBe('Severe'));
  it('labels ANAPHYLAXIS', () => expect(severityLabel('ANAPHYLAXIS')).toBe('Anaphylaxis risk'));
});

describe('severityTone', () => {
  it('MILD is neutral', () => expect(severityTone('MILD')).toBe('neutral'));
  it('MODERATE is warning', () => expect(severityTone('MODERATE')).toBe('warning'));
  it('SEVERE is danger', () => expect(severityTone('SEVERE')).toBe('danger'));
  it('ANAPHYLAXIS is danger', () => expect(severityTone('ANAPHYLAXIS')).toBe('danger'));
});

describe('sortAllergies', () => {
  it('orders highest severity first', () => {
    const sorted = sortAllergies([
      allergy('A', 'MILD'),
      allergy('B', 'ANAPHYLAXIS'),
      allergy('C', 'MODERATE'),
      allergy('D', 'SEVERE'),
    ]);
    expect(sorted.map((a) => a.severity)).toEqual(['ANAPHYLAXIS', 'SEVERE', 'MODERATE', 'MILD']);
  });

  it('breaks ties by allergen A-Z, case-insensitive', () => {
    const sorted = sortAllergies([allergy('egg', 'SEVERE'), allergy('Apple', 'SEVERE'), allergy('Cashew', 'SEVERE')]);
    expect(sorted.map((a) => a.allergen)).toEqual(['Apple', 'Cashew', 'egg']);
  });

  it('does not mutate the input and returns a new array', () => {
    const input = [allergy('A', 'MILD'), allergy('B', 'SEVERE')];
    const copy = [...input];
    const out = sortAllergies(input);
    expect(out).not.toBe(input);
    expect(input).toEqual(copy);
    expect(input[0].allergen).toBe('A');
  });

  it('returns an empty array for empty input', () => expect(sortAllergies([])).toEqual([]));
});

describe('allergySummary', () => {
  it('is empty string when there are no allergies', () => expect(allergySummary([])).toBe(''));

  it('lists a single allergen', () => expect(allergySummary([allergy('Peanuts', 'ANAPHYLAXIS')])).toBe('Peanuts'));

  it('joins up to 3 in severity order', () => {
    expect(
      allergySummary([allergy('Milk', 'MILD'), allergy('Peanuts', 'ANAPHYLAXIS'), allergy('Egg', 'SEVERE')]),
    ).toBe('Peanuts, Egg, Milk');
  });

  it('truncates beyond 3 with "and N more"', () => {
    expect(
      allergySummary([
        allergy('Peanuts', 'ANAPHYLAXIS'),
        allergy('Egg', 'SEVERE'),
        allergy('Milk', 'MODERATE'),
        allergy('Soy', 'MILD'),
        allergy('Wheat', 'MILD'),
      ]),
    ).toBe('Peanuts, Egg, Milk and 2 more');
  });

  it('says "and 1 more" for four items', () => {
    expect(
      allergySummary([allergy('A', 'MILD'), allergy('B', 'MILD'), allergy('C', 'MILD'), allergy('D', 'MILD')]),
    ).toBe('A, B, C and 1 more');
  });
});

describe('hasSeriousAllergy', () => {
  it('is false for empty', () => expect(hasSeriousAllergy([])).toBe(false));
  it('is false for mild and moderate only', () => {
    expect(hasSeriousAllergy([allergy('A', 'MILD'), allergy('B', 'MODERATE')])).toBe(false);
  });
  it('is true for SEVERE', () => expect(hasSeriousAllergy([allergy('A', 'MILD'), allergy('B', 'SEVERE')])).toBe(true));
  it('is true for ANAPHYLAXIS', () => expect(hasSeriousAllergy([allergy('A', 'ANAPHYLAXIS')])).toBe(true));
});

describe('sourceLabel', () => {
  it('labels CERTIFICATE', () => expect(sourceLabel('CERTIFICATE')).toBe('Certificate'));
  it('labels AIR_STATEMENT', () => expect(sourceLabel('AIR_STATEMENT')).toBe('AIR statement'));
  it('labels PARENT_DECLARED', () => expect(sourceLabel('PARENT_DECLARED')).toBe('Declared by parent'));
});

describe('immunisationStatusLabel', () => {
  it('labels UNKNOWN', () => expect(immunisationStatusLabel('UNKNOWN')).toBe('Not recorded'));
  it('labels UP_TO_DATE', () => expect(immunisationStatusLabel('UP_TO_DATE')).toBe('Up to date'));
  it('labels CATCH_UP_PLAN', () => expect(immunisationStatusLabel('CATCH_UP_PLAN')).toBe('On a catch-up plan'));
  it('labels MEDICAL_EXEMPTION', () => expect(immunisationStatusLabel('MEDICAL_EXEMPTION')).toBe('Medical exemption'));
});

describe('formatDoseDate', () => {
  it('formats a date in en-AU short style', () => {
    expect(formatDoseDate('2025-03-05')).toMatch(/^5 Mar(ch)? 2025$/);
  });

  it('formats a second date without timezone shifting', () => {
    expect(formatDoseDate('2024-12-31')).toMatch(/^31 Dec(ember)? 2024$/);
  });

  it('does not shift on the first day of a year', () => {
    expect(formatDoseDate('2026-01-01')).toMatch(/^1 Jan(uary)? 2026$/);
  });

  it('returns an invalid string unchanged', () => {
    expect(formatDoseDate('not-a-date')).toBe('not-a-date');
  });
});
