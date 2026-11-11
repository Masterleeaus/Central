\set ON_ERROR_STOP on
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='titan_config_reader' AND rolsuper=false AND rolbypassrls=false)
 THEN RAISE EXCEPTION 'restricted reader role missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='titan_config_writer' AND rolsuper=false AND rolbypassrls=false)
 THEN RAISE EXCEPTION 'restricted writer role missing'; END IF;
END $$;
