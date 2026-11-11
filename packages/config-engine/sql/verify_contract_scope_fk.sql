\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
 BEGIN
  INSERT INTO titan_config.scopes(product,key,environment,kind,scope) VALUES('central','unknown_definition','staging','environment','*');
  RAISE EXCEPTION 'expected foreign_key_violation not raised';
 EXCEPTION WHEN foreign_key_violation THEN NULL;
 END;
END $$;
ROLLBACK;
