\set ON_ERROR_STOP on
BEGIN;
INSERT INTO titan_config.definitions(product,key,owner,value_type,default_value)
 VALUES('central','rls_write','ops','boolean','false'::jsonb);
SAVEPOINT restricted;
SET LOCAL ROLE titan_config_writer;
SELECT set_config('titan_config.company_id','550e8400-e29b-41d4-a716-446655440000',true);
DO $$
BEGIN
 BEGIN
  INSERT INTO titan_config.scopes(product,key,environment,kind,scope)
  VALUES('central','rls_write','staging','company','550e8400-e29b-41d4-a716-446655440001');
  RAISE EXCEPTION 'foreign write accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
ROLLBACK TO SAVEPOINT restricted;
ROLLBACK;
