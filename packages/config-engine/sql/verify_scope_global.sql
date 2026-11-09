\set ON_ERROR_STOP on
BEGIN;
INSERT INTO titan_config.definitions(product,key,owner,value_type,default_value)
 VALUES('central','global_fixture','ops','boolean','false'::jsonb);
DO $$
BEGIN
 BEGIN
  INSERT INTO titan_config.scopes(product,key,environment,kind,scope)
  VALUES('central','global_fixture','staging','environment','spoofed-global');
  RAISE EXCEPTION 'invalid environment scope was accepted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;
ROLLBACK;
