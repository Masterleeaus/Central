\set ON_ERROR_STOP on
BEGIN;
INSERT INTO titan_config.definitions(product,key,owner,value_type,default_value) VALUES('central','negative_fixture','ops','boolean','false'::jsonb);

DO $$
BEGIN
 BEGIN
  INSERT INTO titan_config.scopes(product,key,environment,kind,scope,revision) VALUES('central','negative_fixture','staging','environment','*',-1);
  RAISE EXCEPTION 'expected check_violation not raised';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;
ROLLBACK;
