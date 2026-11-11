\set ON_ERROR_STOP on
DO $$ BEGIN BEGIN INSERT INTO titan_config.service_company_grants(client_id,product,environment,company_id,state) VALUES('unknown_ci','central','stage','550e8400-e29b-41d4-a716-446655440099','active'); RAISE EXCEPTION 'orphan company accepted'; EXCEPTION WHEN foreign_key_violation THEN NULL;END; END $$;
