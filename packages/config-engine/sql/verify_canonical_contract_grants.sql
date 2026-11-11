\set ON_ERROR_STOP on
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='titan_config.service_company_grants'::regclass
 AND confrelid='titan.companies'::regclass AND contype='f')
 THEN RAISE EXCEPTION 'configuration grants have no canonical company FK';END IF;
END $$;
