\set ON_ERROR_STOP on
BEGIN;
INSERT INTO titan_config.definitions(product,key,owner,value_type,default_value)
 VALUES('central','rls_rev','ops','boolean','false'::jsonb);
INSERT INTO titan_config.scopes(product,key,environment,kind,scope)
 VALUES('central','rls_rev','staging','company','550e8400-e29b-41d4-a716-446655440000'),
 ('central','rls_rev','staging','company','550e8400-e29b-41d4-a716-446655440001');
INSERT INTO titan_config.revisions(product,key,environment,kind,scope,revision,value,percentage,actor,reason,action)
 VALUES('central','rls_rev','staging','company','550e8400-e29b-41d4-a716-446655440000',1,'true',100,'ops','test rls','set'),
 ('central','rls_rev','staging','company','550e8400-e29b-41d4-a716-446655440001',1,'false',100,'ops','test rls','set');
SAVEPOINT restricted;
SET LOCAL ROLE titan_config_reader;
SELECT set_config('titan_config.company_id','550e8400-e29b-41d4-a716-446655440000',true);
DO $$
BEGIN
 IF (SELECT count(*) FROM titan_config.revisions WHERE key='rls_rev')<>1
 THEN RAISE EXCEPTION 'revision RLS leaking';END IF;
END $$;
ROLLBACK TO SAVEPOINT restricted;
ROLLBACK;
