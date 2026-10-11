import { answersComplete, cleanAnswers, dueLabel, missingRequired, scaleStrokes, signatureReady, statusTone, type FormField } from '../lib/forms';

const fields: FormField[] = [
  { key: 'name', type: 'text', label: 'Full name', required: true },
  { key: 'swim', type: 'yes_no', label: 'Swimming', required: true },
  { key: 'bus', type: 'choice', label: 'Transport', required: false, options: ['Bus', 'Walk'] },
  { key: 'when', type: 'date', label: 'Date', required: false },
  { key: 'sig', type: 'signature', label: 'Signature', required: true },
];

describe('missingRequired', () => {
  it('lists required fields with no answer, ignoring the signature field', () => {
    expect(missingRequired(fields, {}).map((f) => f.key)).toEqual(['name', 'swim']);
  });

  it('treats a blank text answer as missing but false as an answer for yes/no', () => {
    expect(missingRequired(fields, { name: '   ', swim: false }).map((f) => f.key)).toEqual(['name']);
  });

  it('is empty when everything required is answered', () => {
    expect(missingRequired(fields, { name: 'Jane', swim: true })).toEqual([]);
  });
});

describe('cleanAnswers', () => {
  it('drops empty optional answers so they are not sent', () => {
    expect(cleanAnswers(fields, { name: 'Jane', swim: false, bus: '', when: undefined })).toEqual({ name: 'Jane', swim: false });
  });

  it('keeps only answers for fields on the form', () => {
    expect(cleanAnswers(fields, { name: 'Jane', swim: true, stray: 'x' })).toEqual({ name: 'Jane', swim: true });
  });
});

describe('scaleStrokes', () => {
  it('scales pixel points into 0..1 and clamps strays', () => {
    const out = scaleStrokes([[{ x: 0, y: 0 }, { x: 150, y: 50 }, { x: 400, y: -10 }]], 300, 100);
    expect(out).toEqual([[[0, 0], [0.5, 0.5], [1, 0]]]);
  });

  it('drops strokes with fewer than two points', () => {
    expect(scaleStrokes([[{ x: 1, y: 1 }], [{ x: 0, y: 0 }, { x: 10, y: 10 }]], 100, 100)).toHaveLength(1);
  });
});

describe('signatureReady', () => {
  it('needs a typed name, a drawn stroke and consent', () => {
    const stroke = [[{ x: 0, y: 0 }, { x: 5, y: 5 }]];
    expect(signatureReady('Jane Citizen', stroke, true)).toBe(true);
    expect(signatureReady('  ', stroke, true)).toBe(false);
    expect(signatureReady('Jane', [], true)).toBe(false);
    expect(signatureReady('Jane', stroke, false)).toBe(false);
  });
});

describe('answersComplete', () => {
  it('is true only when no required field is missing', () => {
    expect(answersComplete(fields, { name: 'Jane' })).toBe(false);
    expect(answersComplete(fields, { name: 'Jane', swim: true })).toBe(true);
  });
});

describe('dueLabel and statusTone', () => {
  it('describes the due date relative to today', () => {
    expect(dueLabel(null, '2026-10-20')).toBeNull();
    expect(dueLabel('2026-10-20', '2026-10-20')).toBe('Due today');
    expect(dueLabel('2026-10-21', '2026-10-20')).toBe('Due tomorrow');
    expect(dueLabel('2026-10-25', '2026-10-20')).toBe('Due 25 Oct');
    expect(dueLabel('2026-10-18', '2026-10-20')).toBe('Overdue');
  });

  it('maps status to a badge tone', () => {
    expect(statusTone('PENDING')).toBe('warning');
    expect(statusTone('SIGNED')).toBe('success');
    expect(statusTone('CANCELLED')).toBe('neutral');
  });
});
