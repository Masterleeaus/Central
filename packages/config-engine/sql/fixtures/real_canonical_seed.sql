-- CI-only data in tables created by PR46, never a duplicate canonical schema.
BEGIN;
INSERT INTO titan.companies(id,name,status) VALUES
 ('550e8400-e29b-41d4-a716-446655440000','Company A','active'),
 ('550e8400-e29b-41d4-a716-446655440003','Company C','active');
INSERT INTO titan.identities(id,logto_subject,status)
 VALUES('ee000000-0000-4000-8000-000000000001','operator_a','active');
INSERT INTO titan.company_memberships(id,company_id,identity_id,role,status)
 VALUES('ea000000-0000-4000-8000-000000000001','550e8400-e29b-41d4-a716-446655440000','ee000000-0000-4000-8000-000000000001','owner','active');
INSERT INTO titan.application_entitlements(id,company_id,application_id,status) VALUES
 ('eb000000-0000-4000-8000-000000000001','550e8400-e29b-41d4-a716-446655440000','central','active'),
 ('eb000000-0000-4000-8000-000000000002','550e8400-e29b-41d4-a716-446655440003','central','active');
INSERT INTO titan.application_company_links(id,company_id,application_id,local_company_id)
 VALUES('ec000000-0000-4000-8000-000000000001','550e8400-e29b-41d4-a716-446655440000','sorted','legacy-company-a');
INSERT INTO titan.application_user_links(id,company_id,identity_id,application_id,local_user_id)
 VALUES('ed000000-0000-4000-8000-000000000001','550e8400-e29b-41d4-a716-446655440000','ee000000-0000-4000-8000-000000000001','sorted','legacy-user-a');
INSERT INTO titan_config.definitions(product,key,owner,value_type,default_value)
 VALUES('central','ci_flag','ops','boolean','false'::jsonb);
INSERT INTO titan_config.scopes(product,key,environment,kind,scope,revision) VALUES
 ('central','ci_flag','stage','company','550e8400-e29b-41d4-a716-446655440000',1),
 ('central','ci_flag','stage','company','550e8400-e29b-41d4-a716-446655440003',1);
INSERT INTO titan_config.revisions(product,key,environment,kind,scope,revision,value,percentage,actor,reason,action) VALUES
 ('central','ci_flag','stage','company','550e8400-e29b-41d4-a716-446655440000',1,'true'::jsonb,100,'ci','company A','set'),
 ('central','ci_flag','stage','company','550e8400-e29b-41d4-a716-446655440003',1,'false'::jsonb,100,'ci','company C','set');
INSERT INTO titan_config.service_company_grants(client_id,product,environment,company_id,state,expires_at) VALUES
 ('svc_a','central','stage','550e8400-e29b-41d4-a716-446655440000','active',NULL),
 ('svc_c','central','stage','550e8400-e29b-41d4-a716-446655440003','active',NULL),
 ('svc_revoked','central','stage','550e8400-e29b-41d4-a716-446655440000','revoked',NULL),
 ('svc_expired','central','stage','550e8400-e29b-41d4-a716-446655440000','active',now()-interval '1 day');
COMMIT;
