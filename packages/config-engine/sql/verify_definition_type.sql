\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
 BEGIN
  INSERT INTO titan_config.definitions(product,key,owner,value_type,default_value)
  VALUES('central','wrong_type','ops','javascript','false'::jsonb);
  RAISE EXCEPTION 'untrusted type was accepted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;
ROLLBACK;
