\set ON_ERROR_STOP on
BEGIN;
INSERT INTO titan_config.definitions(product,key,owner,value_type,default_value) VALUES('central','tenant_fixture','ops','boolean','false'::jsonb);
INSERT INTO titan_config.scopes(product,key,environment,kind,scope)
 VALUES('central','tenant_fixture','staging','company','550e8400-e29b-41d4-a716-446655440000'),
 ('central','tenant_fixture','staging','company','550e8400-e29b-41d4-a716-446655440001');
DO $$ BEGIN
 IF (SELECT count(*) FROM titan_config.scopes WHERE key='tenant_fixture')<>2 THEN RAISE EXCEPTION 'tenant collision'; END IF;
END $$;
ROLLBACK;
