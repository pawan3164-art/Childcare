-- Stage U4 perf-only data, layered ON TOP OF the demo seed + seed-perf-data.sql. Run against the ISOLATED
-- childcare_perf database only (never the shared dev DB):
--
--   docker exec -i childcare-dev-postgres-1 psql -U childcare -d childcare_perf < tests/performance/seed-u4-perf-data.sql
--
-- Adds: ~380 calendar events (a year around today, a third room-specific), a year of weekday menus (4 meals/day),
-- allergies on ~half the children, 6 immunisation doses + a status per child, and two published forms
-- ("Excursion consent" with a signature field, "Annual update") with 300 baseline requests for the centre.
-- Runs as the schema owner (bypasses RLS), like the other perf seeds. Idempotent only on a fresh U4 state.

BEGIN;

DO $$
DECLARE
  v_org text; v_centre text; v_admin text; v_tpl1 text := gen_random_uuid()::text; v_tpl2 text := gen_random_uuid()::text;
  f1 jsonb; f2 jsonb;
BEGIN
  SELECT id INTO v_org FROM organisations LIMIT 1;
  SELECT id INTO v_centre FROM centres LIMIT 1;
  SELECT id INTO v_admin FROM users WHERE email = 'admin@sunshine.test';

  -- Calendar: ~1 event/day over -60..+300 days; every third is for one room.
  INSERT INTO centre_events (id, org_id, centre_id, title, description, starts_at, ends_at, all_day, room_id, created_by_user_id)
  SELECT gen_random_uuid()::text, v_org, v_centre, 'Perf event ' || g, 'Perf calendar entry', (current_date + g) + interval '9 hours',
         (current_date + g) + interval '11 hours', false,
         CASE WHEN g % 3 = 0 THEN (SELECT id FROM rooms WHERE centre_id = v_centre ORDER BY id LIMIT 1 OFFSET (abs(g) % 4)) END, v_admin
  FROM generate_series(-60, 300) g;

  -- Menus: 52 weeks of weekdays x 4 meals.
  INSERT INTO menu_items (id, org_id, centre_id, date, meal, description, allergen_notes, updated_by_user_id)
  SELECT gen_random_uuid()::text, v_org, v_centre, d::date, m::"MenuMeal", 'Perf ' || m || ' ' || d::date, CASE WHEN m = 'LUNCH' THEN 'Contains dairy' END, v_admin
  FROM generate_series(current_date - 180, current_date + 180, interval '1 day') d
  CROSS JOIN (VALUES ('MORNING_TEA'), ('LUNCH'), ('AFTERNOON_TEA'), ('LATE_SNACK')) mm(m)
  WHERE extract(isodow FROM d) < 6;

  -- Health: allergies on every other child (1 to 3 each), 6 doses and a status for every child.
  INSERT INTO child_allergies (id, org_id, centre_id, child_id, allergen, severity, reaction, action_plan, recorded_by_user_id)
  SELECT gen_random_uuid()::text, v_org, v_centre, c.id, a.name, a.sev::"AllergySeverity", 'Perf reaction', 'Perf action plan', v_admin
  FROM (SELECT id, row_number() OVER (ORDER BY id) rn FROM children WHERE centre_id = v_centre) c
  JOIN (VALUES (1,'Peanuts','ANAPHYLAXIS'),(2,'Egg','MODERATE'),(3,'Dairy','MILD')) a(k, name, sev) ON a.k <= 1 + (c.rn % 3)
  WHERE c.rn % 2 = 0;

  INSERT INTO child_immunisations (id, org_id, centre_id, child_id, vaccine, dose_date, source, recorded_by_user_id)
  SELECT gen_random_uuid()::text, v_org, v_centre, c.id, 'Vaccine ' || g, DATE '2024-01-01' + (g * 30), 'CERTIFICATE', v_admin
  FROM children c CROSS JOIN generate_series(1, 6) g WHERE c.centre_id = v_centre;

  INSERT INTO child_immunisation_statuses (id, org_id, centre_id, child_id, status, statement_date, updated_by_user_id)
  SELECT gen_random_uuid()::text, v_org, v_centre, c.id, 'UP_TO_DATE', current_date - 30, v_admin
  FROM children c WHERE c.centre_id = v_centre;

  -- Forms: two published templates.
  f1 := '[{"key":"destination","type":"text","label":"Destination","required":true},
          {"key":"allergies_ok","type":"yes_no","label":"Allergy plan up to date","required":true},
          {"key":"sig","type":"signature","label":"Signature","required":true}]'::jsonb;
  f2 := '[{"key":"phone","type":"text","label":"Best phone","required":false},{"key":"notes","type":"text","label":"Notes","required":false}]'::jsonb;
  INSERT INTO form_templates (id, org_id, centre_id, title, description, fields, latest_version, dirty, created_by_user_id)
  VALUES (v_tpl1, v_org, v_centre, 'Perf Excursion consent', 'perf', f1, 1, false, v_admin),
         (v_tpl2, v_org, v_centre, 'Perf Annual update', 'perf', f2, 1, false, v_admin);
  INSERT INTO form_template_versions (id, org_id, centre_id, template_id, version, title, description, fields, published_by_user_id, published_at)
  VALUES (gen_random_uuid()::text, v_org, v_centre, v_tpl1, 1, 'Perf Excursion consent', 'perf', f1, v_admin, now()),
         (gen_random_uuid()::text, v_org, v_centre, v_tpl2, 1, 'Perf Annual update', 'perf', f2, v_admin, now());

  -- 300 baseline requests: 3 per child (2 pending, 1 cancelled) to each child's guardian(s).
  INSERT INTO form_requests (id, org_id, centre_id, template_id, template_version, child_id, guardian_user_id, status, created_by_user_id, created_at, cancelled_at, cancelled_by_user_id)
  SELECT gen_random_uuid()::text, v_org, v_centre, CASE WHEN g = 1 THEN v_tpl1 ELSE v_tpl2 END, 1, r.child_id, r.guardian_user_id,
         CASE WHEN g = 3 THEN 'CANCELLED' ELSE 'PENDING' END::"FormRequestStatus", v_admin, now() - (g * r.rn * interval '1 minute'),
         CASE WHEN g = 3 THEN now() END, CASE WHEN g = 3 THEN v_admin END
  FROM (SELECT child_id, guardian_user_id, row_number() OVER () rn FROM guardian_child_relationships
        WHERE centre_id = v_centre AND NOT is_restricted AND relationship_type IN ('PARENT','GUARDIAN')) r
  CROSS JOIN generate_series(1, 3) g;
END $$;

COMMIT;

ANALYZE;
