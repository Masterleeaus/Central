\set ON_ERROR_STOP on
BEGIN;
INSERT INTO titan_config.definitions(product,key,owner,value_type,default_value)
 VALUES('central','rls_own','ops','boolean','false'::jsonb);
SAVEPOINT restricted;
SET LOCAL ROLE titan_config_writer;
SELECT set_config('titan_config.company_id','550e8400-e29b-41d4-a716-446655440000',true);
INSERT INTO titan_config.scopes(product,key,environment,kind,scope)
 VALUES('central','rls_own','staging','company','550e8400-e29b-41d4-a716-446655440000');
DO $$
BEGIN
 IF (SELECT count(*) FROM titan_config.scopes WHERE key='rls_own')<>1
 THEN RAISE EXCEPTION 'own-company insert not visible'; END IF;
END $$;
ROLLBACK TO SAVEPOINT restricted;
ROLLBACK;
