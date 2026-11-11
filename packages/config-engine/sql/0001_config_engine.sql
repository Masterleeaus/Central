BEGIN;
CREATE SCHEMA IF NOT EXISTS titan_config;
CREATE TABLE titan_config.definitions (
 product text NOT NULL CHECK(product IN ('central','sorted','supercharged','lms')),
 key text NOT NULL CHECK(key ~ '^[a-z][a-z0-9_-]{0,63}$'),
 owner text NOT NULL, value_type text NOT NULL CHECK(value_type IN ('boolean','integer','string')),
 default_value jsonb NOT NULL, allowed_values jsonb, description text NOT NULL DEFAULT '',
 PRIMARY KEY(product,key)
);
CREATE TABLE titan_config.scopes (
 product text NOT NULL, key text NOT NULL, environment text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('environment','cohort','company')),
 scope text NOT NULL, revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
 PRIMARY KEY(product,key,environment,kind,scope),
 FOREIGN KEY(product,key) REFERENCES titan_config.definitions(product,key),
 CHECK((kind='environment' AND scope='*') OR (kind='cohort' AND scope ~ '^[a-z][a-z0-9_-]{0,63}$') OR (kind='company' AND scope ~* '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'))
);
CREATE TABLE titan_config.revisions (
 product text NOT NULL,key text NOT NULL,environment text NOT NULL,kind text NOT NULL,scope text NOT NULL,
 revision bigint NOT NULL CHECK(revision>0), value jsonb NOT NULL, percentage int NOT NULL CHECK(percentage BETWEEN 0 AND 100),
 expires_at timestamptz, actor text NOT NULL, reason text NOT NULL, action text NOT NULL CHECK(action IN ('set','rollback')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(product,key,environment,kind,scope,revision),
 FOREIGN KEY(product,key,environment,kind,scope) REFERENCES titan_config.scopes(product,key,environment,kind,scope)
);
CREATE TABLE titan_config.audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 product text NOT NULL,key text NOT NULL,environment text NOT NULL,kind text NOT NULL,scope text NOT NULL,
 revision bigint NOT NULL,actor text NOT NULL,reason text NOT NULL,action text NOT NULL,
 correlation_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(product,key,environment,kind,scope,revision) REFERENCES titan_config.revisions(product,key,environment,kind,scope,revision)
);
REVOKE ALL ON SCHEMA titan_config FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA titan_config FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA titan_config FROM PUBLIC;
COMMIT;
