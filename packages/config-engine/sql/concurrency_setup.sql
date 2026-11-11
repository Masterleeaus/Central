\set ON_ERROR_STOP on
INSERT INTO titan_config.definitions(product,key,owner,value_type,default_value)
 VALUES('central','parallel_fixture','ops','boolean','false'::jsonb);
INSERT INTO titan_config.scopes(product,key,environment,kind,scope)
 VALUES('central','parallel_fixture','staging','environment','*');
