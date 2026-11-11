\set ON_ERROR_STOP on
BEGIN;
INSERT INTO titan_config.definitions(product,key,owner,value_type,default_value)
 VALUES('central','rls_global','ops','boolean','false'::jsonb);
INSERT INTO titan_config.scopes(product,key,environment,kind,scope) VALUES('central','rls_global','staging','environment','*');
SAVEPOINT restricted;
SET LOCAL ROLE titan_config_reader;

DO $$
BEGIN
 IF (SELECT count(*) FROM titan_config.scopes WHERE key='rls_global')<>1
 THEN RAISE EXCEPTION 'RLS read count incorrect for rls_global';END IF;
END $$;
ROLLBACK TO SAVEPOINT restricted;
ROLLBACK;
