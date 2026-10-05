/**
 * Demo data for local testing of the portal and educator app. Connects via
 * DATABASE_URL (the schema-owner role), which bypasses RLS the same way
 * test fixtures do — this is a trusted, local-only seeding path, never how
 * the running application itself talks to the database.
 *
 * Run with: npm run prisma:seed
 * Prints the demo login credentials at the end.
 */
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

const DEMO_PASSWORD = 'Password123!';

const ALL_TABLES = [
  'checklist_completions', 'checklist_templates', 'direct_messages', 'direct_threads', 'feed_post_media', 'feed_posts',
  'payment_records', 'ccs_session_reports', 'ccs_enrolments', 'ledger_entries', 'invoices',
  'ccs_entitlements', 'absences', 'bookings', 'fee_schedules',
  'message_acknowledgements', 'messages', 'incident_acknowledgements', 'incidents',
  'medication_administrations', 'medication_authorizations',
  'media_asset_child_tags', 'media_assets', 'care_records', 'attendance_events',
  'sync_operations', 'notification_queue_items', 'audit_log_entries',
  'guardian_child_relationships', 'staff_room_assignments', 'sessions',
  'children', 'rooms', 'centres', 'users', 'organisations',
];

/** Idempotent: wipes all application data (not the Prisma migration history) so this can be re-run freely during local testing. */
async function reset() {
  console.log('Resetting existing data...');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} CASCADE;`);
}

async function main() {
  await reset();
  console.log('Seeding demo data...');

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const org = await prisma.organisation.create({
    data: { name: 'Sunshine Early Learning' },
  });

  const centre = await prisma.centre.create({
    data: { orgId: org.id, name: 'Sunshine Early Learning - Richmond', timezone: 'Australia/Sydney' },
  });

  const joeysRoom = await prisma.room.create({
    data: { orgId: org.id, centreId: centre.id, name: 'Joeys (Toddlers)', ageBandMin: 12, ageBandMax: 35 },
  });
  const kangaroosRoom = await prisma.room.create({
    data: { orgId: org.id, centreId: centre.id, name: 'Kangaroos (Preschool)', ageBandMin: 36, ageBandMax: 59 },
  });

  const admin = await prisma.user.create({
    data: {
      orgId: org.id,
      centreId: centre.id,
      email: 'admin@sunshine.test',
      passwordHash,
      role: 'CENTRE_ADMIN',
      firstName: 'Alex',
      lastName: 'Director',
    },
  });

  const educatorJoeys = await prisma.user.create({
    data: {
      orgId: org.id,
      centreId: centre.id,
      email: 'educator.joeys@sunshine.test',
      passwordHash,
      role: 'EDUCATOR',
      firstName: 'Priya',
      lastName: 'Educator',
    },
  });
  const educatorKangaroos = await prisma.user.create({
    data: {
      orgId: org.id,
      centreId: centre.id,
      email: 'educator.kangaroos@sunshine.test',
      passwordHash,
      role: 'EDUCATOR',
      firstName: 'Sam',
      lastName: 'Educator',
    },
  });

  await prisma.staffRoomAssignment.create({
    data: { orgId: org.id, centreId: centre.id, userId: educatorJoeys.id, roomId: joeysRoom.id, startDate: new Date('2026-01-01') },
  });
  await prisma.staffRoomAssignment.create({
    data: { orgId: org.id, centreId: centre.id, userId: educatorKangaroos.id, roomId: kangaroosRoom.id, startDate: new Date('2026-01-01') },
  });

  // U1 room checklists (CMP-003): two centre-wide, one for the Joeys sleep room.
  const checklistTemplates: { name: string; roomId: string | null; items: string[] }[] = [
    { name: 'Opening check', roomId: null, items: ['Gates and doors secure', 'Outdoor area swept for hazards', 'First-aid kit stocked', 'Fridge temperature below 5°C'] },
    { name: 'Closing check', roomId: null, items: ['All children signed out', 'Windows and doors locked', 'Heaters and appliances off'] },
    { name: 'Sleep room', roomId: joeysRoom.id, items: ['Cots clear of soft toys and loose bedding', 'Room temperature 16–20°C', 'Cot sides up and locked'] },
  ];
  for (const t of checklistTemplates) {
    await prisma.checklistTemplate.create({
      data: { orgId: org.id, centreId: centre.id, roomId: t.roomId, name: t.name, items: t.items.map((label) => ({ id: randomUUID(), label })), createdByUserId: admin.id },
    });
  }

  const joeysFeeSchedule = await prisma.feeSchedule.create({
    data: {
      orgId: org.id,
      centreId: centre.id,
      roomId: joeysRoom.id,
      name: 'Joeys daily fee',
      feeType: 'DAILY',
      amountCents: 12000,
      siblingDiscountPercent: 10,
      effectiveFrom: new Date('2026-01-01'),
    },
  });
  const kangaroosFeeSchedule = await prisma.feeSchedule.create({
    data: {
      orgId: org.id,
      centreId: centre.id,
      roomId: kangaroosRoom.id,
      name: 'Kangaroos daily fee',
      feeType: 'DAILY',
      amountCents: 11000,
      siblingDiscountPercent: 10,
      effectiveFrom: new Date('2026-01-01'),
    },
  });

  const parentFamilies = [
    { email: 'parent.chen@example.test', firstName: 'Mei', lastName: 'Chen', children: [{ firstName: 'Lucas', lastName: 'Chen', dob: '2023-03-15', room: joeysRoom, fee: joeysFeeSchedule }] },
    {
      email: 'parent.nguyen@example.test',
      firstName: 'Anh',
      lastName: 'Nguyen',
      children: [
        { firstName: 'Mia', lastName: 'Nguyen', dob: '2022-07-22', room: joeysRoom, fee: joeysFeeSchedule },
        { firstName: 'Noah', lastName: 'Nguyen', dob: '2021-11-02', room: kangaroosRoom, fee: kangaroosFeeSchedule },
      ],
    },
    { email: 'parent.smith@example.test', firstName: 'Jordan', lastName: 'Smith', children: [{ firstName: 'Ava', lastName: 'Smith', dob: '2021-05-10', room: kangaroosRoom, fee: kangaroosFeeSchedule }] },
  ];

  for (const family of parentFamilies) {
    const guardian = await prisma.user.create({
      data: {
        orgId: org.id,
        centreId: centre.id,
        email: family.email,
        passwordHash,
        role: 'PARENT',
        firstName: family.firstName,
        lastName: family.lastName,
      },
    });

    for (const c of family.children) {
      const child = await prisma.child.create({
        data: {
          orgId: org.id,
          centreId: centre.id,
          roomId: c.room.id,
          firstName: c.firstName,
          lastName: c.lastName,
          dateOfBirth: new Date(c.dob),
        },
      });

      await prisma.guardianChildRelationship.create({
        data: {
          orgId: org.id,
          centreId: centre.id,
          guardianUserId: guardian.id,
          childId: child.id,
          relationshipType: 'PARENT',
          canViewMedia: true,
          canViewBilling: true,
          canPickup: true,
        },
      });

      await prisma.booking.create({
        data: {
          orgId: org.id,
          centreId: centre.id,
          childId: child.id,
          roomId: c.room.id,
          feeScheduleId: c.fee.id,
          bookingType: 'PERMANENT',
          daysOfWeek: [1, 2, 3, 4, 5],
          startDate: new Date('2026-01-01'),
        },
      });

      await prisma.ccsEntitlement.create({
        data: {
          orgId: org.id,
          centreId: centre.id,
          childId: child.id,
          estimatedSubsidyPercent: 65,
          effectiveFrom: new Date('2026-01-01'),
        },
      });
    }
  }

  console.log('\nSeed complete.\n');
  console.log('Demo accounts (all use password: ' + DEMO_PASSWORD + '):');
  console.log('  Centre admin:         admin@sunshine.test');
  console.log('  Educator (Joeys):     educator.joeys@sunshine.test');
  console.log('  Educator (Kangaroos): educator.kangaroos@sunshine.test');
  console.log('  Parent (1 child):     parent.chen@example.test');
  console.log('  Parent (2 children):  parent.nguyen@example.test');
  console.log('  Parent (1 child):     parent.smith@example.test');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
