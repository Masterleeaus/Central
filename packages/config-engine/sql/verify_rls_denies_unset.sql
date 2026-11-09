\set ON_ERROR_STOP on
BEGIN;
INSERT INTO titan_config.definitions(product,key,owner,value_type,default_value)
 VALUES('central','rls_unset','ops','boolean','false'::jsonb);
INSERT INTO titan_config.scopes(product,key,environment,kind,scope) VALUES('central','rls_unset','staging','company','550e8400-e29b-41d4-a716-446655440000');
SAVEPOINT restricted;
SET LOCAL ROLE titan_config_reader;

DO $$
BEGIN
 IF (SELECT count(*) FROM titan_config.scopes WHERE key='rls_unset')<>0
 THEN RAISE EXCEPTION 'RLS read count incorrect for rls_unset';END IF;
END $$;
ROLLBACK TO SAVEPOINT restricted;
ROLLBACK;
