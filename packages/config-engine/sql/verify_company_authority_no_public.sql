\set ON_ERROR_STOP on
DO $$
BEGIN
 IF has_table_privilege('public','titan.company_memberships','SELECT') OR
 has_table_privilege('public','titan.application_entitlements','SELECT') THEN
 RAISE EXCEPTION 'public authority access';END IF;
END $$;
