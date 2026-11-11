\set ON_ERROR_STOP on
BEGIN;
INSERT INTO titan_config.definitions(product,key,owner,value_type,default_value) VALUES('central','negative_fixture','ops','boolean','false'::jsonb);
INSERT INTO titan_config.scopes(product,key,environment,kind,scope) VALUES('central','negative_fixture','staging','environment','*');
DO $$
BEGIN
 BEGIN
  INSERT INTO titan_config.revisions(product,key,environment,kind,scope,revision,value,percentage,actor,reason,action) VALUES('central','negative_fixture','staging','environment','*',0,'true',100,'ops','invalid zero','set');
  RAISE EXCEPTION 'expected check_violation not raised';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;
ROLLBACK;
