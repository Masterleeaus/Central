\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
 BEGIN
  INSERT INTO titan_config.definitions(product,key,owner,value_type,default_value)
  VALUES('other','invalid_product','ops','boolean','false'::jsonb);
  RAISE EXCEPTION 'invalid product was accepted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;
ROLLBACK;
