/**
 * Feature modules and plans (BRD v2.3 CUS-001, PLT-001, PLT-002; decision DL-025).
 *
 * Critical modules are the protected core: they are on for every centre on every plan, whatever the
 * payment status, and cannot be switched off. Optional modules can be left out of a plan or switched
 * off by a centre; switching one off hides it and refuses its API calls but keeps all its data.
 */
export type PlanKey = 'core' | 'full';

export interface ModuleDef {
  readonly key: string;
  readonly label: string;
  readonly critical: boolean;
  readonly plans: readonly PlanKey[];
}

const both: readonly PlanKey[] = Object.freeze(['core', 'full'] as PlanKey[]);
const fullOnly: readonly PlanKey[] = Object.freeze(['full'] as PlanKey[]);
const def = (key: string, label: string, critical: boolean, plans: readonly PlanKey[]): ModuleDef => Object.freeze({ key, label, critical, plans });

export const MODULES: readonly ModuleDef[] = Object.freeze([
  def('attendance', 'Attendance', true, both),
  def('care_records', 'Care records', true, both),
  def('medication', 'Medication', true, both),
  def('incidents', 'Incidents', true, both),
  def('messaging', 'Messaging and emergency broadcast', true, both),
  def('privacy', 'Privacy and data export', true, both),
  def('health_records', 'Health records', true, both),
  def('family_requests', 'Family requests', false, both),
  def('calendar', 'Calendar', false, both),
  def('menus', 'Menus', false, both),
  def('learning', 'Learning', false, fullOnly),
  def('billing', 'Billing and CCS', false, fullOnly),
  def('checklists', 'Room checklists', false, fullOnly),
]);

const keysFor = (plan: PlanKey) => Object.freeze(MODULES.filter((m) => m.plans.includes(plan)).map((m) => m.key));

export const PLANS: Readonly<Record<PlanKey, readonly string[]>> = Object.freeze({ core: keysFor('core'), full: keysFor('full') });

/** No plan row means this one, so existing organisations keep everything until pricing is decided (OI-31). */
export const DEFAULT_PLAN: PlanKey = 'full';

const KEYS = new Set(MODULES.map((m) => m.key));
export const isModuleKey = (key: unknown): key is string => typeof key === 'string' && KEYS.has(key);
export const isPlanKey = (plan: unknown): plan is PlanKey => plan === 'core' || plan === 'full';
export const moduleDef = (key: string): ModuleDef | undefined => (isModuleKey(key) ? MODULES.find((m) => m.key === key) : undefined);
