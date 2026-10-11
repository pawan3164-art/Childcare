export type Severity = 'MILD' | 'MODERATE' | 'SEVERE' | 'ANAPHYLAXIS';
export type ImmunisationSource = 'CERTIFICATE' | 'AIR_STATEMENT' | 'PARENT_DECLARED';
export type ImmunisationStatusKey = 'UNKNOWN' | 'UP_TO_DATE' | 'CATCH_UP_PLAN' | 'MEDICAL_EXEMPTION';

export interface AllergyItem {
  id: string;
  allergen: string;
  severity: Severity;
  reaction: string | null;
  actionPlan: string | null;
}

export interface ImmunisationItem {
  id: string;
  vaccine: string;
  doseDate: string;
  source: ImmunisationSource;
}

const RANK: Record<Severity, number> = { ANAPHYLAXIS: 0, SEVERE: 1, MODERATE: 2, MILD: 3 };

export function severityLabel(s: Severity): string {
  return { MILD: 'Mild', MODERATE: 'Moderate', SEVERE: 'Severe', ANAPHYLAXIS: 'Anaphylaxis risk' }[s];
}

export function severityTone(s: Severity): 'neutral' | 'warning' | 'danger' {
  return s === 'MILD' ? 'neutral' : s === 'MODERATE' ? 'warning' : 'danger';
}

/** Most serious first, then A-Z. Returns a new array. */
export function sortAllergies(items: AllergyItem[]): AllergyItem[] {
  return [...items].sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.allergen.toLowerCase().localeCompare(b.allergen.toLowerCase()));
}

export function allergySummary(items: AllergyItem[]): string {
  const names = sortAllergies(items).map((i) => i.allergen);
  if (names.length <= 3) return names.join(', ');
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
}

export function hasSeriousAllergy(items: AllergyItem[]): boolean {
  return items.some((i) => i.severity === 'SEVERE' || i.severity === 'ANAPHYLAXIS');
}

export function sourceLabel(s: ImmunisationSource): string {
  return { CERTIFICATE: 'Certificate', AIR_STATEMENT: 'AIR statement', PARENT_DECLARED: 'Declared by parent' }[s];
}

export function immunisationStatusLabel(status: ImmunisationStatusKey): string {
  return { UNKNOWN: 'Not recorded', UP_TO_DATE: 'Up to date', CATCH_UP_PLAN: 'On a catch-up plan', MEDICAL_EXEMPTION: 'Medical exemption' }[status];
}

/** A calendar date shown without any device timezone shift. */
export function formatDoseDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
