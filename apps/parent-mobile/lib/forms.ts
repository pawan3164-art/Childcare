export type FieldType = 'text' | 'date' | 'yes_no' | 'choice' | 'child_select' | 'signature';

export interface FormField {
  key: string;
  type: FieldType;
  label: string;
  required: boolean;
  options?: string[];
}

export type RequestStatus = 'PENDING' | 'SIGNED' | 'CANCELLED';

export interface FormRequestItem {
  id: string;
  templateId: string;
  templateVersion: number;
  title: string;
  childId: string;
  status: RequestStatus;
  dueDate: string | null;
  signedAt: string | null;
}

export interface FormRequestDetail extends FormRequestItem {
  description: string | null;
  fields: FormField[];
}

export type Answers = Record<string, unknown>;
export type Point = { x: number; y: number };

const isBlank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/** Required fields (not the signature, which has its own step) that still have no answer. `false` is an answer. */
export function missingRequired(fields: FormField[], answers: Answers): FormField[] {
  return fields.filter((f) => f.type !== 'signature' && f.required && isBlank(answers[f.key]));
}

export function answersComplete(fields: FormField[], answers: Answers): boolean {
  return missingRequired(fields, answers).length === 0;
}

/** What is sent: only answers for fields on the form, without empty optional ones. */
export function cleanAnswers(fields: FormField[], answers: Answers): Answers {
  const out: Answers = {};
  for (const f of fields) {
    if (f.type === 'signature') continue;
    const v = answers[f.key];
    if (!isBlank(v)) out[f.key] = v;
  }
  return out;
}

const clamp01 = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000;

/** Limits the server accepts for a signature. */
export const MAX_STROKES = 20;
export const MAX_POINTS_PER_STROKE = 300;

/** Pixel strokes from the pad, scaled to 0..1 of the pad size (what the server stores). */
export function scaleStrokes(strokes: Point[][], width: number, height: number): number[][][] {
  return strokes
    .filter((s) => s.length >= 2)
    .map((s) => s.map((p) => [clamp01(p.x / width), clamp01(p.y / height)]));
}

export function signatureReady(typedName: string, strokes: Point[][], consent: boolean): boolean {
  return typedName.trim().length > 0 && strokes.some((s) => s.length >= 2) && consent;
}

export function dueLabel(dueDate: string | null, today: string): string | null {
  if (!dueDate) return null;
  if (dueDate < today) return 'Overdue';
  if (dueDate === today) return 'Due today';
  const next = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  if (dueDate === next) return 'Due tomorrow';
  const d = new Date(`${dueDate}T00:00:00Z`);
  const day = new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', day: 'numeric' }).format(d);
  const month = new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', month: 'short' }).format(d);
  return `Due ${day} ${month}`;
}

export function statusTone(status: RequestStatus): 'warning' | 'success' | 'neutral' {
  return status === 'PENDING' ? 'warning' : status === 'SIGNED' ? 'success' : 'neutral';
}
