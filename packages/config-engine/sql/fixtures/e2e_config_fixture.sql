-- Disposable CI-only signed-JWT integration dataset. No real users or companies.
BEGIN;
INSERT INTO titan.companies(id,name,status)
 VALUES('550e8400-e29b-41d4-a716-446655440003','E2E Company C','active');
INSERT INTO titan_config.definitions(product,key,owner,value_type,default_value)
 VALUES('central','ci_flag','ops','boolean','false'::jsonb);
INSERT INTO titan_config.scopes(product,key,environment,kind,scope,revision)
 VALUES('central','ci_flag','stage','company','550e8400-e29b-41d4-a716-446655440000',1),
 ('central','ci_flag','stage','company','550e8400-e29b-41d4-a716-446655440003',1);
INSERT INTO titan_config.revisions
 (product,key,environment,kind,scope,revision,value,percentage,actor,reason,action)
 VALUES('central','ci_flag','stage','company','550e8400-e29b-41d4-a716-446655440000',1,'true'::jsonb,100,'ci','test tenant A','set'),
 ('central','ci_flag','stage','company','550e8400-e29b-41d4-a716-446655440003',1,'false'::jsonb,100,'ci','test tenant C','set');
INSERT INTO titan_config.service_company_grants(client_id,product,environment,company_id,state)
 VALUES('svc_a','central','stage','550e8400-e29b-41d4-a716-446655440000','active'),
 ('svc_c','central','stage','550e8400-e29b-41d4-a716-446655440003','active'),
 ('svc_revoked','central','stage','550e8400-e29b-41d4-a716-446655440000','revoked'),
 ('svc_expired','central','stage','550e8400-e29b-41d4-a716-446655440000','active',now()-interval '1 day');
COMMIT;
