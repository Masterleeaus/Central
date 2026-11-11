\set ON_ERROR_STOP on
BEGIN;
INSERT INTO titan_config.definitions(product,key,owner,value_type,default_value)
 VALUES('central','scope_fixture','ops','boolean','false'::jsonb);
DO $$
BEGIN
 BEGIN
  INSERT INTO titan_config.scopes(product,key,environment,kind,scope)
  VALUES('central','scope_fixture','staging','untrusted','*');
  RAISE EXCEPTION 'invalid scope kind was accepted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;
ROLLBACK;
