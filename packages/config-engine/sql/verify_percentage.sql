\set ON_ERROR_STOP on
BEGIN;
INSERT INTO titan_config.definitions(product,key,owner,value_type,default_value) VALUES('central','percent_fixture','ops','boolean','false'::jsonb);
INSERT INTO titan_config.scopes(product,key,environment,kind,scope) VALUES('central','percent_fixture','staging','environment','*');
DO $$ BEGIN
 BEGIN
 INSERT INTO titan_config.revisions(product,key,environment,kind,scope,revision,value,percentage,actor,reason,action)
 VALUES('central','percent_fixture','staging','environment','*',1,'true'::jsonb,101,'ops','invalid percentage','set');
 RAISE EXCEPTION 'invalid percentage accepted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 IF EXISTS(SELECT 1 FROM titan_config.revisions WHERE key='percent_fixture') THEN RAISE EXCEPTION 'invalid revision persisted'; END IF;
END $$;
ROLLBACK;
