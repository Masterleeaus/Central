\set ON_ERROR_STOP on
BEGIN;
INSERT INTO titan_config.definitions(product,key,owner,value_type,default_value)
 VALUES('central','action_fixture','ops','boolean','false'::jsonb);
INSERT INTO titan_config.scopes(product,key,environment,kind,scope)
 VALUES('central','action_fixture','staging','environment','*');
DO $$
BEGIN
 BEGIN
  INSERT INTO titan_config.revisions(product,key,environment,kind,scope,revision,value,percentage,actor,reason,action)
  VALUES('central','action_fixture','staging','environment','*',1,'true'::jsonb,50,'ops','invalid action','execute');
  RAISE EXCEPTION 'untrusted revision action accepted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;
ROLLBACK;
