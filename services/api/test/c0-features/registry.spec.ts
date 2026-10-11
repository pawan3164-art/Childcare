import { DEFAULT_PLAN, isModuleKey, MODULES, PLANS } from '../../src/features/features.registry';

describe('C0 features registry (CUS-001, PLT-001, PLT-002)', () => {
  const expected = [
    { key: 'attendance', label: 'Attendance', critical: true, plans: ['core', 'full'] },
    { key: 'care_records', label: 'Care records', critical: true, plans: ['core', 'full'] },
    { key: 'medication', label: 'Medication', critical: true, plans: ['core', 'full'] },
    { key: 'incidents', label: 'Incidents', critical: true, plans: ['core', 'full'] },
    { key: 'messaging', label: 'Messaging and emergency broadcast', critical: true, plans: ['core', 'full'] },
    { key: 'privacy', label: 'Privacy and data export', critical: true, plans: ['core', 'full'] },
    { key: 'family_requests', label: 'Family requests', critical: false, plans: ['core', 'full'] },
    { key: 'learning', label: 'Learning', critical: false, plans: ['full'] },
    { key: 'billing', label: 'Billing and CCS', critical: false, plans: ['full'] },
    { key: 'checklists', label: 'Room checklists', critical: false, plans: ['full'] },
  ];

  it('MODULES is exactly the agreed table, in order', () => {
    expect(MODULES.map((m) => ({ ...m, plans: [...m.plans] }))).toEqual(expected);
  });

  it('PLANS: core = every critical module plus family_requests; full = all modules', () => {
    const critical = expected.filter((m) => m.critical).map((m) => m.key);
    expect([...PLANS.core]).toEqual([...critical, 'family_requests']);
    expect([...PLANS.full]).toEqual(expected.map((m) => m.key));
  });

  it('every critical module is in every plan (PLT-002 protected core)', () => {
    for (const m of MODULES.filter((x) => x.critical)) {
      for (const plan of Object.keys(PLANS) as Array<keyof typeof PLANS>) {
        expect(PLANS[plan]).toContain(m.key);
      }
      expect([...m.plans]).toEqual(['core', 'full']);
    }
  });

  it('PLANS agrees with each module plans list', () => {
    for (const plan of ['core', 'full'] as const) {
      const fromModules = MODULES.filter((m) => m.plans.includes(plan)).map((m) => m.key);
      expect([...PLANS[plan]]).toEqual(fromModules);
    }
  });

  it('DEFAULT_PLAN is full so existing organisations are unchanged', () => {
    expect(DEFAULT_PLAN).toBe('full');
  });

  it('isModuleKey accepts known keys only', () => {
    for (const m of MODULES) expect(isModuleKey(m.key)).toBe(true);
    for (const bad of ['', 'Learning', 'unknown', 'constructor', '__proto__', 'toString']) expect(isModuleKey(bad)).toBe(false);
  });

  it('exports are frozen', () => {
    expect(Object.isFrozen(MODULES)).toBe(true);
    expect(Object.isFrozen(PLANS)).toBe(true);
    expect(Object.isFrozen(PLANS.core)).toBe(true);
    expect(Object.isFrozen(PLANS.full)).toBe(true);
    expect(() => {
      (MODULES as any).push({ key: 'x' });
    }).toThrow();
    expect(() => {
      (PLANS.core as any).push('learning');
    }).toThrow();
  });
});
