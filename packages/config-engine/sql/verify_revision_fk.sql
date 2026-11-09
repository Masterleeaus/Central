\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
 BEGIN
  INSERT INTO titan_config.revisions(product,key,environment,kind,scope,revision,value,percentage,actor,reason,action)
  VALUES('central','unknown_feature','staging','environment','*',1,'true'::jsonb,100,'ops','missing parent','set');
  RAISE EXCEPTION 'orphan revision was accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL;
 END;
END $$;
ROLLBACK;
