-- An area manager works across centres and must never carry a centre of their own: some centre-level checks key on
-- the centre id, so setting one would hand them that centre's data.
ALTER TABLE "users" ADD CONSTRAINT "users_area_manager_has_no_centre" CHECK (role <> 'AREA_MANAGER' OR centre_id IS NULL);
