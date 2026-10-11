import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { disconnectAll, fixturePrisma } from '../test-utils';

const dir = join(__dirname, '..', '..', 'prisma', 'migrations');
const all = (): string[] => readdirSync(dir).filter((n) => n !== 'migration_lock.toml').map((n) => readFileSync(join(dir, n, 'migration.sql'), 'utf8'));
const tableSql = (): string => {
  const hit = all().filter((s) => /CREATE TABLE "area_manager_centres"/.test(s));
  expect(hit).toHaveLength(1);
  return hit[0];
};

describe('area_manager_centres migration (file)', () => {
  it('adds AREA_MANAGER to the UserRole enum', () => {
    expect(all().some((s) => /ALTER TYPE "UserRole" ADD VALUE( IF NOT EXISTS)? 'AREA_MANAGER'/.test(s))).toBe(true);
  });

  it('adds a nullable licensed_capacity integer column to centres', () => {
    const s = all().find((x) => /licensed_capacity/.test(x));
    expect(s).toBeDefined();
    expect(s).toMatch(/ALTER TABLE "centres" ADD COLUMN\s+"licensed_capacity" INTEGER(?!\s+NOT NULL)/);
  });

  it('enables and forces RLS with an org-based policy', () => {
    const s = tableSql();
    expect(s).toMatch(/ALTER TABLE area_manager_centres ENABLE ROW LEVEL SECURITY/);
    expect(s).toMatch(/ALTER TABLE area_manager_centres FORCE ROW LEVEL SECURITY/);
    expect(s).toMatch(/CREATE POLICY \w+ ON area_manager_centres/);
    expect(s).toMatch(/app\.current_org_id/);
  });

  it('grants the app role SELECT, INSERT and DELETE but never UPDATE (or ALL)', () => {
    const s = tableSql();
    const grants = s.match(/GRANT [^;]*ON area_manager_centres[^;]*;/g) ?? [];
    expect(grants.length).toBeGreaterThan(0);
    const joined = grants.join('\n');
    expect(joined).toMatch(/SELECT/);
    expect(joined).toMatch(/INSERT/);
    expect(joined).toMatch(/DELETE/);
    expect(joined).toMatch(/TO childcare_app/);
    for (const g of grants) expect(g).not.toMatch(/UPDATE|\bALL\b/i);
  });

  it('has a unique index on (user_id, centre_id)', () => {
    expect(tableSql()).toMatch(/CREATE UNIQUE INDEX [^;]*ON "area_manager_centres"\("user_id",\s*"centre_id"\)/);
  });
});

describe('area_manager_centres (live database)', () => {
  afterAll(async () => {
    await disconnectAll();
  });

  it('the table has row level security enabled and forced', async () => {
    const rows: any[] = await fixturePrisma.$queryRawUnsafe(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'area_manager_centres'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].relrowsecurity).toBe(true);
    expect(rows[0].relforcerowsecurity).toBe(true);
  });

  it('the app role has SELECT, INSERT, DELETE and no UPDATE privilege', async () => {
    const has = async (priv: string) => {
      const r: any[] = await fixturePrisma.$queryRawUnsafe(`SELECT has_table_privilege('childcare_app', 'area_manager_centres', '${priv}') AS ok`);
      return r[0].ok;
    };
    expect(await has('SELECT')).toBe(true);
    expect(await has('INSERT')).toBe(true);
    expect(await has('DELETE')).toBe(true);
    expect(await has('UPDATE')).toBe(false);
  });

  it('centres.licensed_capacity exists, is integer and nullable', async () => {
    const rows: any[] = await fixturePrisma.$queryRawUnsafe(
      `SELECT data_type, is_nullable FROM information_schema.columns WHERE table_name = 'centres' AND column_name = 'licensed_capacity'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].data_type).toBe('integer');
    expect(rows[0].is_nullable).toBe('YES');
  });

  it('the UserRole enum includes AREA_MANAGER', async () => {
    const rows: any[] = await fixturePrisma.$queryRawUnsafe(`SELECT unnest(enum_range(NULL::"UserRole"))::text AS v`);
    expect(rows.map((r) => r.v)).toContain('AREA_MANAGER');
  });
});
