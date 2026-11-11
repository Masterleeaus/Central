\set ON_ERROR_STOP on
BEGIN;
INSERT INTO titan_config.definitions(product,key,owner,value_type,default_value)
 VALUES('central','duplicate_fixture','ops','boolean','false'::jsonb);
DO $$
BEGIN
 BEGIN
  INSERT INTO titan_config.definitions(product,key,owner,value_type,default_value)
  VALUES('central','duplicate_fixture','ops','boolean','true'::jsonb);
  RAISE EXCEPTION 'duplicate definition accepted';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
END $$;
ROLLBACK;
