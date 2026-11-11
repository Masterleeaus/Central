\set ON_ERROR_STOP on
BEGIN;
INSERT INTO titan_config.definitions(product,key,owner,value_type,default_value)
 VALUES('central','rls_foreign','ops','boolean','false'::jsonb);
INSERT INTO titan_config.scopes(product,key,environment,kind,scope) VALUES('central','rls_foreign','staging','company','550e8400-e29b-41d4-a716-446655440000');
INSERT INTO titan_config.scopes(product,key,environment,kind,scope) VALUES('central','rls_foreign','staging','company','550e8400-e29b-41d4-a716-446655440001');
SAVEPOINT restricted;
SET LOCAL ROLE titan_config_reader;
SELECT set_config('titan_config.company_id','550e8400-e29b-41d4-a716-446655440001',true);

DO $$
BEGIN
 IF (SELECT count(*) FROM titan_config.scopes WHERE key='rls_foreign')<>1
 THEN RAISE EXCEPTION 'RLS read count incorrect for rls_foreign';END IF;
END $$;
ROLLBACK TO SAVEPOINT restricted;
ROLLBACK;
