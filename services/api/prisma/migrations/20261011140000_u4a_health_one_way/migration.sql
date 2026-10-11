-- Ending an allergy or voiding a dose is one-way: the end/void columns can be set once and never changed or cleared.
CREATE OR REPLACE FUNCTION health_end_is_one_way() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'child_allergies' THEN
    IF OLD.ended_at IS NOT NULL AND (NEW.ended_at IS DISTINCT FROM OLD.ended_at OR NEW.ended_by_user_id IS DISTINCT FROM OLD.ended_by_user_id OR NEW.end_reason IS DISTINCT FROM OLD.end_reason) THEN
      RAISE EXCEPTION 'An ended allergy cannot be changed';
    END IF;
  ELSE
    IF OLD.voided_at IS NOT NULL AND (NEW.voided_at IS DISTINCT FROM OLD.voided_at OR NEW.voided_by_user_id IS DISTINCT FROM OLD.voided_by_user_id OR NEW.void_reason IS DISTINCT FROM OLD.void_reason) THEN
      RAISE EXCEPTION 'A voided immunisation cannot be changed';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER child_allergies_one_way BEFORE UPDATE ON child_allergies FOR EACH ROW EXECUTE FUNCTION health_end_is_one_way();
CREATE TRIGGER child_immunisations_one_way BEFORE UPDATE ON child_immunisations FOR EACH ROW EXECUTE FUNCTION health_end_is_one_way();
