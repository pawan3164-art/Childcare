-- Retention (OI-41): signed submissions stay immutable for the web API, but the maintenance role
-- (anything other than childcare_app) may delete them when the retention period has passed.
-- The app role also has no DELETE grant, so this is a second lock.
CREATE OR REPLACE FUNCTION forms_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND TG_TABLE_NAME = 'form_submissions' AND current_user <> 'childcare_app' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% rows are immutable (% blocked)', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;
