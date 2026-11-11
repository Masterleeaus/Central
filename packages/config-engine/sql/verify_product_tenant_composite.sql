\set ON_ERROR_STOP on
BEGIN;
INSERT INTO titan_config.definitions(product,key,owner,value_type,default_value)
 VALUES('central','composite_fixture','ops','boolean','false'::jsonb),
 ('sorted','composite_fixture','ops','boolean','false'::jsonb);
INSERT INTO titan_config.scopes(product,key,environment,kind,scope)
 VALUES('central','composite_fixture','staging','environment','*'),
 ('sorted','composite_fixture','staging','environment','*');
DO $$
BEGIN
 IF (SELECT count(DISTINCT product) FROM titan_config.scopes WHERE key='composite_fixture')<>2
 THEN RAISE EXCEPTION 'product isolation broken'; END IF;
END $$;
ROLLBACK;
