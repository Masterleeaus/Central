\set ON_ERROR_STOP on
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='titan.application_entitlements'::regclass
 AND confrelid='titan.companies'::regclass AND contype='f')
 THEN RAISE EXCEPTION 'canonical entitlement FK missing';END IF;
END $$;
