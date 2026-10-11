import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const dir = join(__dirname, '..', '..', 'prisma', 'migrations');
const sql = (): string => {
  const hit = readdirSync(dir)
    .filter((n) => n !== 'migration_lock.toml')
    .map((n) => readFileSync(join(dir, n, 'migration.sql'), 'utf8'))
    .filter((s) => /CREATE TABLE "payment_attempts"/.test(s));
  expect(hit).toHaveLength(1);
  return hit[0];
};

describe('payment_attempts migration', () => {
  it('creates the table with RLS enabled and forced, with a tenant policy', () => {
    const s = sql();
    expect(s).toMatch(/ALTER TABLE payment_attempts ENABLE ROW LEVEL SECURITY/);
    expect(s).toMatch(/ALTER TABLE payment_attempts FORCE ROW LEVEL SECURITY/);
    expect(s).toMatch(/CREATE POLICY \w+ ON payment_attempts/);
    expect(s).toMatch(/app\.current_org_id/);
  });
  it('never grants DELETE to the app role', () => {
    const s = sql();
    expect(s).toMatch(/GRANT [^;]*ON payment_attempts TO childcare_app/);
    for (const g of s.match(/GRANT [^;]*ON payment_attempts[^;]*;/g) ?? []) expect(g).not.toMatch(/DELETE|ALL/i);
  });
  it('has a unique index on (org_id, idempotency_key)', () => {
    expect(sql()).toMatch(/CREATE UNIQUE INDEX [^;]*ON "payment_attempts"\("org_id",\s*"idempotency_key"\)/);
  });
});
