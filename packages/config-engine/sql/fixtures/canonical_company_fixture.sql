-- Disposable database fixture only, matching the titan.companies shape in unmerged PR #46.
BEGIN;
CREATE SCHEMA IF NOT EXISTS titan;
CREATE TABLE titan.companies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK (length(btrim(name))>0),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','closed')),
 settings jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO titan.companies(id,name,status) VALUES
('550e8400-e29b-41d4-a716-446655440000','Company A','active'),
('550e8400-e29b-41d4-a716-446655440001','Company B','suspended');
COMMIT;
