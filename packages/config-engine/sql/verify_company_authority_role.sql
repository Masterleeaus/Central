\set ON_ERROR_STOP on
DO $$
BEGIN
 IF NOT has_column_privilege('titan_config_company_authority_reader','titan.company_memberships','role','SELECT')
 OR NOT has_column_privilege('titan_config_company_authority_reader','titan.identities','logto_subject','SELECT')
 OR has_table_privilege('titan_config_company_authority_reader','titan.company_memberships','INSERT')
 THEN RAISE EXCEPTION 'authority role incorrect';END IF;
END $$;
