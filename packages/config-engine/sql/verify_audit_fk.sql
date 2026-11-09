\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
 BEGIN
  INSERT INTO titan_config.audit(product,key,environment,kind,scope,revision,actor,reason,action,correlation_id)
  VALUES('central','unknown_feature','staging','environment','*',1,'ops','missing revision','set','trace');
  RAISE EXCEPTION 'orphan audit row was accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL;
 END;
END $$;
ROLLBACK;
