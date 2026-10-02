import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

/**
 * Fixture setup uses the schema-owner connection (DATABASE_URL, superuser in
 * dev) so it can freely create rows across tenants without RLS getting in the
 * way. Tests that assert isolation/authorization use `appPrisma`/PrismaService
 * wired the same way the running app is (DATABASE_APP_URL, restricted role,
 * RLS enforced) — that's the point of the test.
 */
export const fixturePrisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
export const appPrisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_APP_URL });

export async function setTenantContext(
  client: PrismaClient,
  orgId: string,
  centreId?: string | null,
): Promise<void> {
  await client.$executeRaw`SELECT set_config('app.current_org_id', ${orgId}, false)`;
  await client.$executeRaw`SELECT set_config('app.current_centre_id', ${centreId ?? ''}, false)`;
}

export interface SeededTenant {
  orgId: string;
  centreId: string;
  roomId: string;
}

let counter = 0;
export function uniqueSuffix(): string {
  counter += 1;
  return `${Date.now()}_${process.pid}_${counter}`;
}

export async function seedOrgCentreRoom(label: string): Promise<SeededTenant> {
  const suffix = uniqueSuffix();
  const org = await fixturePrisma.organisation.create({
    data: { name: `Test Org ${label} ${suffix}` },
  });
  const centre = await fixturePrisma.centre.create({
    data: { orgId: org.id, name: `Test Centre ${label} ${suffix}` },
  });
  const room = await fixturePrisma.room.create({
    data: { orgId: org.id, centreId: centre.id, name: `Test Room ${label} ${suffix}` },
  });
  return { orgId: org.id, centreId: centre.id, roomId: room.id };
}

export async function disconnectAll(): Promise<void> {
  await fixturePrisma.$disconnect();
  await appPrisma.$disconnect();
}
