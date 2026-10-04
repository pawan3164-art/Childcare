-- Perf-only bulk data, layered ON TOP OF the normal demo seed
-- (services/api/prisma/seed.ts). Run against an ISOLATED database
-- (e.g. childcare_perf), never the shared dev `childcare` DB:
--
--   docker exec -i childcare-dev-postgres-1 psql -U childcare -d childcare_perf < tests/performance/seed-perf-data.sql
--
-- Shape: one centre, 4 rooms x 25 children = 100 children (a large but
-- realistic long-day-care centre), each with a guardian, permanent Mon-Fri
-- booking, CCS entitlement, and ~90 days of attendance + care-record history
-- so read endpoints are measured against non-trivial row counts.
-- Runs as the schema owner (bypasses RLS), like the demo seed.

BEGIN;

DO $$
DECLARE
  v_org text; v_centre text; v_hash text; v_admin text;
  v_room record; v_fee text; v_child text; v_parent text;
  n int; i int;
BEGIN
  SELECT id INTO v_org FROM organisations LIMIT 1;
  SELECT id INTO v_centre FROM centres LIMIT 1;
  SELECT id, password_hash INTO v_admin, v_hash FROM users WHERE email = 'admin@sunshine.test';

  -- Two extra rooms (Joeys + Kangaroos already exist from the demo seed).
  INSERT INTO rooms (id, org_id, centre_id, name, age_band_min_months, age_band_max_months)
  VALUES (gen_random_uuid()::text, v_org, v_centre, 'Wombats (Babies)', 0, 11),
         (gen_random_uuid()::text, v_org, v_centre, 'Koalas (Pre-K)', 48, 71);

  FOR v_room IN SELECT id, name FROM rooms WHERE centre_id = v_centre ORDER BY name LOOP
    SELECT id INTO v_fee FROM fee_schedules WHERE room_id = v_room.id LIMIT 1;
    IF v_fee IS NULL THEN
      v_fee := gen_random_uuid()::text;
      INSERT INTO fee_schedules (id, org_id, centre_id, room_id, name, fee_type, amount_cents, sibling_discount_percent, effective_from)
      VALUES (v_fee, v_org, v_centre, v_room.id, v_room.name || ' daily fee', 'DAILY', 11500, 10, DATE '2026-01-01');
    END IF;

    SELECT count(*) INTO n FROM children WHERE room_id = v_room.id;
    FOR i IN (n + 1)..25 LOOP
      v_child := gen_random_uuid()::text;
      v_parent := gen_random_uuid()::text;
      INSERT INTO children (id, org_id, centre_id, room_id, first_name, last_name, date_of_birth)
      VALUES (v_child, v_org, v_centre, v_room.id, 'Perf' || i, split_part(v_room.name, ' ', 1), DATE '2023-01-01' - (i * 7));
      INSERT INTO users (id, org_id, centre_id, email, password_hash, role, first_name, last_name)
      VALUES (v_parent, v_org, v_centre, 'perf.parent.' || lower(split_part(v_room.name, ' ', 1)) || '.' || i || '@example.test', v_hash, 'PARENT', 'Perf', 'Parent' || i);
      INSERT INTO guardian_child_relationships (id, org_id, centre_id, guardian_user_id, child_id, relationship_type, can_view_media, can_view_billing, can_pickup)
      VALUES (gen_random_uuid()::text, v_org, v_centre, v_parent, v_child, 'PARENT', true, true, true);
      INSERT INTO bookings (id, org_id, centre_id, child_id, room_id, fee_schedule_id, booking_type, days_of_week, start_date)
      VALUES (gen_random_uuid()::text, v_org, v_centre, v_child, v_room.id, v_fee, 'PERMANENT', ARRAY[1,2,3,4,5], DATE '2026-01-01');
      INSERT INTO ccs_entitlements (id, org_id, centre_id, child_id, estimated_subsidy_percent, effective_from)
      VALUES (gen_random_uuid()::text, v_org, v_centre, v_child, 50 + (i % 40), DATE '2026-01-01');
    END LOOP;
  END LOOP;

  -- ~90 days of weekday history for every child: sign-in/out + 5 care records/day.
  INSERT INTO attendance_events (id, org_id, centre_id, child_id, event_type, method, "timestamp", recorded_by_user_id)
  SELECT gen_random_uuid()::text, v_org, v_centre, c.id, ev.t::"AttendanceEventType", 'KIOSK', d + ev.off, v_admin
  FROM children c
  CROSS JOIN generate_series(current_date - 90, current_date - 1, interval '1 day') d
  CROSS JOIN (VALUES ('SIGN_IN', interval '7 hours 45 minutes'), ('SIGN_OUT', interval '17 hours 10 minutes')) ev(t, off)
  WHERE extract(isodow FROM d) < 6;

  INSERT INTO care_records (id, org_id, centre_id, child_id, type, "timestamp", note, group_event_id, recorded_by_user_id)
  SELECT gen_random_uuid()::text, v_org, v_centre, c.id, cr.t::"CareRecordType", d + cr.off, 'perf history', gen_random_uuid()::text, v_admin
  FROM children c
  CROSS JOIN generate_series(current_date - 90, current_date - 1, interval '1 day') d
  CROSS JOIN (VALUES ('MEAL', interval '9 hours'), ('MEAL', interval '12 hours'), ('SLEEP', interval '13 hours'),
                     ('TOILETING', interval '10 hours'), ('TOILETING', interval '15 hours')) cr(t, off)
  WHERE extract(isodow FROM d) < 6;

  -- Incidents + medication so the list endpoints have > take-limit rows.
  INSERT INTO incidents (id, org_id, centre_id, child_id, severity, description, occurred_at, reported_by_user_id)
  SELECT gen_random_uuid()::text, v_org, v_centre, c.id, 'MINOR', 'perf incident', now() - (g * interval '1 day'), v_admin
  FROM children c CROSS JOIN generate_series(1, 3) g;

  INSERT INTO medication_authorizations (id, org_id, centre_id, child_id, medication_name, dosage_instructions, authorized_by_guardian_id)
  SELECT gen_random_uuid()::text, v_org, v_centre, c.id, 'Perfamol', '5ml as needed', r.guardian_user_id
  FROM children c JOIN guardian_child_relationships r ON r.child_id = c.id;

  INSERT INTO medication_administrations (id, org_id, centre_id, authorization_id, administered_by_user_id, administered_at, dosage_given)
  SELECT gen_random_uuid()::text, v_org, v_centre, a.id, v_admin, now() - (g * interval '1 day'), '5ml'
  FROM medication_authorizations a CROSS JOIN generate_series(1, 5) g;
END $$;

COMMIT;

ANALYZE;
