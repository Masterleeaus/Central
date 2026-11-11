\set ON_ERROR_STOP on
DO $$ BEGIN IF has_table_privilege('titan_config_api_login','titan_config.service_company_grants','SELECT') OR has_table_privilege('titan_config_grants_login','titan_config.revisions','SELECT') THEN RAISE EXCEPTION 'database roles not isolated';END IF; END $$;
