\set ON_ERROR_STOP on
BEGIN;
INSERT INTO titan_config.definitions(product,key,owner,value_type,default_value)
 VALUES('central','rls_cohorts','ops','boolean','false'::jsonb);
INSERT INTO titan_config.scopes(product,key,environment,kind,scope) VALUES('central','rls_cohorts','staging','cohort','alpha');
INSERT INTO titan_config.scopes(product,key,environment,kind,scope) VALUES('central','rls_cohorts','staging','cohort','bravo');
SAVEPOINT restricted;
SET LOCAL ROLE titan_config_reader;
SELECT set_config('titan_config.cohorts','alpha',true);

DO $$
BEGIN
 IF (SELECT count(*) FROM titan_config.scopes WHERE key='rls_cohorts')<>1
 THEN RAISE EXCEPTION 'RLS read count incorrect for rls_cohorts';END IF;
END $$;
ROLLBACK TO SAVEPOINT restricted;
ROLLBACK;
