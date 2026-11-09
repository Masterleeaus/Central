\set ON_ERROR_STOP on
BEGIN;
INSERT INTO titan_config.definitions(product,key,owner,value_type,default_value)
 VALUES('central','rls_noinsert','ops','boolean','false'::jsonb);
SAVEPOINT restricted;
SET LOCAL ROLE titan_config_reader;
DO $$
BEGIN
 BEGIN
  INSERT INTO titan_config.scopes(product,key,environment,kind,scope)
  VALUES('central','rls_noinsert','staging','environment','*');
  RAISE EXCEPTION 'reader mutation succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
ROLLBACK TO SAVEPOINT restricted;
ROLLBACK;
