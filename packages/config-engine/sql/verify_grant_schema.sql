\set ON_ERROR_STOP on
DO $$
BEGIN
 IF to_regclass('titan_config.service_company_grants') IS NULL THEN RAISE EXCEPTION 'missing registry';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='titan_config.service_company_grants'::regclass AND contype='u')
 THEN RAISE EXCEPTION 'missing grant uniqueness'; END IF;
END $$;
