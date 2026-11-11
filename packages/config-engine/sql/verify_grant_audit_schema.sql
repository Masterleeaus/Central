\set ON_ERROR_STOP on
DO $$
BEGIN
 IF to_regclass('titan_config.service_grant_audit') IS NULL
 OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='titan_config.service_company_grants'::regclass
  AND tgname='config_service_grant_audit_trigger' AND NOT tgisinternal) THEN
  RAISE EXCEPTION 'grant audit schema or trigger missing';
 END IF;
END $$;
