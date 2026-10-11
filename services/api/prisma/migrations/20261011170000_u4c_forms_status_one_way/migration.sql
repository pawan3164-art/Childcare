-- A signed or cancelled request can never go back to pending (or change status again).
CREATE FUNCTION form_requests_status_one_way() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'PENDING' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'form request status % is final', OLD.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER form_requests_status_one_way BEFORE UPDATE ON form_requests
  FOR EACH ROW EXECUTE FUNCTION form_requests_status_one_way();
