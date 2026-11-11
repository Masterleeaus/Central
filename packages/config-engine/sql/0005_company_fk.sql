-- Draft FK only. Requires canonical shared schema and migration authority of #43.
BEGIN;
DO $$
BEGIN
 IF to_regclass('titan.companies') IS NULL THEN RAISE EXCEPTION 'canonical companies missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='titan.companies'::regclass
  AND attname='id' AND atttypid='uuid'::regtype)
 THEN RAISE EXCEPTION 'canonical company ID mismatch'; END IF;
END $$;
ALTER TABLE titan_config.service_company_grants ADD CONSTRAINT config_grant_company_fk
 FOREIGN KEY(company_id) REFERENCES titan.companies(id) ON DELETE RESTRICT;
GRANT USAGE ON SCHEMA titan TO titan_config_grant_reader;
GRANT SELECT(id,status) ON titan.companies TO titan_config_grant_reader;
COMMIT;
