-- Disposable CI only, reproduces tables of unmerged canonical PR #46.
BEGIN;
CREATE TABLE titan.identities(id uuid PRIMARY KEY,logto_subject text NOT NULL UNIQUE,status text NOT NULL);
CREATE TABLE titan.company_memberships(id uuid PRIMARY KEY,
 company_id uuid NOT NULL REFERENCES titan.companies(id),
 identity_id uuid NOT NULL REFERENCES titan.identities(id),
 role text NOT NULL,status text NOT NULL,expires_at timestamptz);
CREATE TABLE titan.application_entitlements(id uuid PRIMARY KEY,
 company_id uuid NOT NULL REFERENCES titan.companies(id),
 application_id text NOT NULL,status text NOT NULL,expires_at timestamptz);
INSERT INTO titan.identities VALUES('ee000000-0000-4000-8000-000000000001','operator_a','active'),
 ('ee000000-0000-4000-8000-000000000002','operator_b','active');
INSERT INTO titan.company_memberships VALUES
 ('ea000000-0000-4000-8000-000000000001','550e8400-e29b-41d4-a716-446655440000','ee000000-0000-4000-8000-000000000001','owner','active',NULL),
 ('ea000000-0000-4000-8000-000000000002','550e8400-e29b-41d4-a716-446655440001','ee000000-0000-4000-8000-000000000002','admin','active',NULL);
INSERT INTO titan.application_entitlements VALUES
 ('eb000000-0000-4000-8000-000000000001','550e8400-e29b-41d4-a716-446655440000','central','active',NULL),
 ('eb000000-0000-4000-8000-000000000002','550e8400-e29b-41d4-a716-446655440001','central','active',NULL);
COMMIT;
