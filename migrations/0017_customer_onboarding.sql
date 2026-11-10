-- REVIEW BEFORE APPLYING. Issue #41: guided customer onboarding and product provisioning.
-- Applied after 0014. Numbered 0017 as requested; 0015 and 0016 are on other branches.
--
-- Tables
--   titan.onboardings                 one row per onboarding. idempotency_key, organisation_id and
--                                     logto_organisation_id are each unique, so a retry cannot create a
--                                     second onboarding, organisation or Logto organisation mapping.
--   titan.onboarding_product_results  one row per selected product: a granted entitlement (and optional
--                                     account link) or a structured failure code. Never a free-text error.
--   titan.onboarding_events           append-only lifecycle audit. Written by trigger from every state
--                                     change, in the same transaction, with the actor and request ID.
--
-- State machine. The trigger titan.onboarding_before_update is the authority; the Node module
-- (packages/control-plane/src/onboarding.ts) checks the same table first only to return a clear error.
--   pending   -> verified     owner identity proof recorded (owner_proof_at, owner_proof_digest)
--   pending   -> failed
--   verified  -> provisioned  every selected product succeeded AND the owner's active owner membership
--                             and the organisation both exist in titan.* (checked by the trigger)
--   verified  -> failed
--   failed    -> verified     resume; refused once the onboarding has been rolled back
--   failed    -> failed       rollback, once: every granted entitlement and link must already be revoked
--   provisioned               terminal
--
-- Owner and account matching. The owner is keyed only by logto_subject from the authenticated principal.
-- There is no email column and no lookup by email anywhere in this schema.
--
-- Tenant isolation. titan.onboardings and both child tables are row-level secured on organisation_id,
-- like migrations 0006 and 0008. Tenant roles can read their own progress only and cannot write.
BEGIN;

CREATE TABLE IF NOT EXISTS titan.onboardings (
  id uuid PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 16 AND 128),
  organisation_id uuid NOT NULL UNIQUE,
  logto_organisation_id text NOT NULL UNIQUE CHECK (length(logto_organisation_id) BETWEEN 1 AND 256),
  owner_logto_subject text NOT NULL CHECK (length(owner_logto_subject) BETWEEN 1 AND 256),
  organisation_name text NOT NULL CHECK (length(organisation_name) BETWEEN 1 AND 200 AND organisation_name = btrim(organisation_name)),
  products text[] NOT NULL CHECK (cardinality(products) BETWEEN 1 AND 3 AND products <@ ARRAY['desk','field','academy']::text[]),
  request_digest text NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('pending','verified','provisioned','failed')),
  owner_proof_at timestamptz,
  owner_proof_digest text CHECK (owner_proof_digest ~ '^[0-9a-f]{64}$'),
  failure_code text CHECK (failure_code IN ('core_provisioning_failed','product_provisioning_failed')),
  rolled_back_at timestamptz,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organisation_id),
  CHECK ((owner_proof_at IS NULL) = (owner_proof_digest IS NULL)),
  CHECK (state IN ('pending','failed') OR owner_proof_at IS NOT NULL),
  CHECK ((state = 'failed') = (failure_code IS NOT NULL)),
  CHECK (rolled_back_at IS NULL OR state = 'failed')
);

CREATE TABLE IF NOT EXISTS titan.onboarding_product_results (
  onboarding_id uuid NOT NULL,
  organisation_id uuid NOT NULL,
  application_id text NOT NULL CHECK (application_id IN ('desk','field','academy')),
  account_link_required boolean NOT NULL DEFAULT false,
  outcome text NOT NULL CHECK (outcome IN ('succeeded','failed')),
  failure_code text CHECK (failure_code IN ('not_authorised','conflict','account_link_review','provisioning_unavailable')),
  entitlement_id uuid REFERENCES titan.entitlements(id),
  entitlement_request_id uuid,
  link_id uuid REFERENCES titan.local_account_links(id),
  link_request_id uuid,
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts >= 1),
  rolled_back_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (onboarding_id, application_id),
  FOREIGN KEY (onboarding_id, organisation_id) REFERENCES titan.onboardings(id, organisation_id),
  CHECK ((outcome = 'failed') = (failure_code IS NOT NULL)),
  CHECK (outcome <> 'succeeded' OR (entitlement_id IS NOT NULL AND entitlement_request_id IS NOT NULL)),
  CHECK (outcome <> 'succeeded' OR NOT account_link_required OR link_id IS NOT NULL),
  CHECK ((link_id IS NULL) = (link_request_id IS NULL)),
  CHECK (rolled_back_at IS NULL OR entitlement_id IS NOT NULL OR link_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS titan.onboarding_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  onboarding_id uuid NOT NULL REFERENCES titan.onboardings(id),
  organisation_id uuid NOT NULL,
  from_state text CHECK (from_state IS NULL OR from_state IN ('pending','verified','provisioned','failed')),
  to_state text NOT NULL CHECK (to_state IN ('pending','verified','provisioned','failed')),
  event text NOT NULL CHECK (event IN ('started','owner_proved','provisioned','failed','resumed','rolled_back')),
  actor_subject text NOT NULL CHECK (length(actor_subject) > 0),
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS onboarding_events_onboarding_idx ON titan.onboarding_events (onboarding_id, id);

-- Every write must name the actor and the request. The application sets both with set_config(..., true)
-- inside the same transaction, so they end with it and cannot leak to a pooled connection.
CREATE OR REPLACE FUNCTION titan.onboarding_require_actor() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF NULLIF(current_setting('titan.actor_subject', true), '') IS NULL
     OR NULLIF(current_setting('titan.request_id', true), '') IS NULL THEN
    RAISE EXCEPTION 'onboarding write requires titan.actor_subject and titan.request_id' USING ERRCODE = 'check_violation';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION titan.onboarding_before_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM titan.onboarding_require_actor();
  IF NEW.state <> 'pending' OR NEW.owner_proof_at IS NOT NULL OR NEW.rolled_back_at IS NOT NULL OR NEW.revision <> 1 THEN
    RAISE EXCEPTION 'an onboarding starts pending, with no proof and no rollback' USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT count(DISTINCT p) FROM unnest(NEW.products) AS p) <> cardinality(NEW.products) THEN
    RAISE EXCEPTION 'onboarding products must be distinct' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION titan.onboarding_before_update() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE granted_open bigint;
BEGIN
  PERFORM titan.onboarding_require_actor();
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id OR NEW.logto_organisation_id IS DISTINCT FROM OLD.logto_organisation_id
     OR NEW.owner_logto_subject IS DISTINCT FROM OLD.owner_logto_subject OR NEW.organisation_name IS DISTINCT FROM OLD.organisation_name
     OR NEW.products IS DISTINCT FROM OLD.products OR NEW.request_digest IS DISTINCT FROM OLD.request_digest
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'onboarding identity and request fields are immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.owner_proof_at IS NOT NULL AND (NEW.owner_proof_at IS DISTINCT FROM OLD.owner_proof_at OR NEW.owner_proof_digest IS DISTINCT FROM OLD.owner_proof_digest) THEN
    RAISE EXCEPTION 'owner proof is immutable once recorded' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.state = OLD.state THEN
    -- The only same-state write is the one-time rollback mark on a failed onboarding.
    IF NOT (OLD.state = 'failed' AND OLD.rolled_back_at IS NULL AND NEW.rolled_back_at IS NOT NULL) THEN
      RAISE EXCEPTION 'invalid onboarding transition % -> %', OLD.state, NEW.state USING ERRCODE = 'check_violation';
    END IF;
    SELECT count(*) INTO granted_open FROM titan.onboarding_product_results r
     WHERE r.onboarding_id = OLD.id AND r.rolled_back_at IS NULL AND (r.entitlement_id IS NOT NULL OR r.link_id IS NOT NULL);
    IF granted_open <> 0 THEN
      RAISE EXCEPTION 'rollback requires every granted entitlement and link to be revoked first' USING ERRCODE = 'check_violation';
    END IF;
    NEW.revision := OLD.revision + 1;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF (OLD.state, NEW.state) NOT IN (('pending','verified'), ('verified','provisioned'), ('pending','failed'), ('verified','failed'), ('failed','verified')) THEN
    RAISE EXCEPTION 'invalid onboarding transition % -> %', OLD.state, NEW.state USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.state = 'verified' AND NEW.owner_proof_at IS NULL THEN
    RAISE EXCEPTION 'verification requires owner identity proof' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.state = 'verified' AND NEW.rolled_back_at IS NOT NULL THEN
    RAISE EXCEPTION 'a rolled back onboarding cannot resume' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.state = 'provisioned' THEN
    IF (SELECT count(*) FROM titan.onboarding_product_results r
         WHERE r.onboarding_id = OLD.id AND r.outcome = 'succeeded' AND r.rolled_back_at IS NULL) <> cardinality(OLD.products) THEN
      RAISE EXCEPTION 'provisioned requires every selected product to have succeeded' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM titan.organisations o WHERE o.id = OLD.organisation_id AND o.logto_organisation_id = OLD.logto_organisation_id) THEN
      RAISE EXCEPTION 'provisioned requires the canonical organisation' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM titan.memberships m JOIN titan.identities i ON i.id = m.identity_id
                    WHERE m.organisation_id = OLD.organisation_id AND i.logto_subject = OLD.owner_logto_subject
                      AND m.role = 'owner' AND m.state = 'active') THEN
      RAISE EXCEPTION 'provisioned requires an active owner membership for the proven identity' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  -- A structured failure code describes only the current failed state.
  IF NEW.state <> 'failed' THEN
    NEW.failure_code := NULL;
  END IF;
  NEW.revision := OLD.revision + 1;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION titan.onboarding_after_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE actor text := current_setting('titan.actor_subject', true);
        req uuid := current_setting('titan.request_id', true)::uuid;
        ev text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO titan.onboarding_events (onboarding_id, organisation_id, from_state, to_state, event, actor_subject, request_id)
    VALUES (NEW.id, NEW.organisation_id, NULL, NEW.state, 'started', actor, req);
    RETURN NULL;
  END IF;
  IF OLD.state = NEW.state THEN
    ev := 'rolled_back';
  ELSE
    ev := CASE
      WHEN OLD.state = 'pending' AND NEW.state = 'verified' THEN 'owner_proved'
      WHEN OLD.state = 'verified' AND NEW.state = 'provisioned' THEN 'provisioned'
      WHEN OLD.state = 'failed' AND NEW.state = 'verified' THEN 'resumed'
      ELSE 'failed'
    END;
  END IF;
  INSERT INTO titan.onboarding_events (onboarding_id, organisation_id, from_state, to_state, event, actor_subject, request_id)
  VALUES (NEW.id, NEW.organisation_id, OLD.state, NEW.state, ev, actor, req);
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION titan.onboarding_product_before_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE o_state text; o_products text[]; o_org uuid; e_org uuid; e_app text; e_state text;
        l_org uuid; l_app text; l_state text;
BEGIN
  PERFORM titan.onboarding_require_actor();
  SELECT state, products, organisation_id INTO o_state, o_products, o_org FROM titan.onboardings WHERE id = NEW.onboarding_id;
  IF NOT (NEW.application_id = ANY (o_products)) THEN
    RAISE EXCEPTION 'product % was not selected for this onboarding', NEW.application_id USING ERRCODE = 'check_violation';
  END IF;
  IF o_state NOT IN ('verified','failed') THEN
    RAISE EXCEPTION 'product results may only change while the onboarding is verified or failed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.organisation_id IS DISTINCT FROM o_org THEN
    RAISE EXCEPTION 'product result organisation must match the onboarding' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    -- Identity of the row never changes. A grant reference, once recorded, is never replaced.
    IF NEW.onboarding_id IS DISTINCT FROM OLD.onboarding_id OR NEW.application_id IS DISTINCT FROM OLD.application_id
       OR NEW.account_link_required IS DISTINCT FROM OLD.account_link_required
       OR (OLD.entitlement_id IS NOT NULL AND NEW.entitlement_id IS DISTINCT FROM OLD.entitlement_id)
       OR (OLD.entitlement_request_id IS NOT NULL AND NEW.entitlement_request_id IS DISTINCT FROM OLD.entitlement_request_id)
       OR (OLD.link_id IS NOT NULL AND NEW.link_id IS DISTINCT FROM OLD.link_id)
       OR (OLD.link_request_id IS NOT NULL AND NEW.link_request_id IS DISTINCT FROM OLD.link_request_id) THEN
      RAISE EXCEPTION 'granted product references are immutable' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.outcome = 'succeeded' AND NEW.outcome <> 'succeeded' THEN
      RAISE EXCEPTION 'a granted product result cannot become a failure' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.rolled_back_at IS NOT NULL AND NEW.rolled_back_at IS DISTINCT FROM OLD.rolled_back_at THEN
      RAISE EXCEPTION 'a rolled back product result is final' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.entitlement_id IS NOT NULL THEN
    SELECT organisation_id, application_id, state INTO e_org, e_app, e_state FROM titan.entitlements WHERE id = NEW.entitlement_id;
    IF e_org IS DISTINCT FROM NEW.organisation_id OR e_app IS DISTINCT FROM NEW.application_id THEN
      RAISE EXCEPTION 'entitlement belongs to another organisation or product' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.link_id IS NOT NULL THEN
    SELECT organisation_id, application_id, state INTO l_org, l_app, l_state FROM titan.local_account_links WHERE id = NEW.link_id;
    IF l_org IS DISTINCT FROM NEW.organisation_id OR l_app IS DISTINCT FROM NEW.application_id THEN
      RAISE EXCEPTION 'account link belongs to another organisation or product' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  -- A rollback mark is only valid once the granted entitlement and link have been revoked.
  IF NEW.rolled_back_at IS NOT NULL THEN
    IF NEW.entitlement_id IS NOT NULL AND e_state <> 'revoked' THEN
      RAISE EXCEPTION 'rollback mark requires the entitlement to be revoked' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.link_id IS NOT NULL AND l_state <> 'revoked' THEN
      RAISE EXCEPTION 'rollback mark requires the account link to be revoked' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION titan.onboarding_events_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'onboarding events are append-only' USING ERRCODE = 'check_violation';
END $$;

DROP TRIGGER IF EXISTS onboardings_before_insert ON titan.onboardings;
CREATE TRIGGER onboardings_before_insert BEFORE INSERT ON titan.onboardings FOR EACH ROW EXECUTE FUNCTION titan.onboarding_before_insert();
DROP TRIGGER IF EXISTS onboardings_before_update ON titan.onboardings;
CREATE TRIGGER onboardings_before_update BEFORE UPDATE ON titan.onboardings FOR EACH ROW EXECUTE FUNCTION titan.onboarding_before_update();
DROP TRIGGER IF EXISTS onboardings_after_write ON titan.onboardings;
CREATE TRIGGER onboardings_after_write AFTER INSERT OR UPDATE ON titan.onboardings FOR EACH ROW EXECUTE FUNCTION titan.onboarding_after_write();
DROP TRIGGER IF EXISTS onboarding_product_results_before_write ON titan.onboarding_product_results;
CREATE TRIGGER onboarding_product_results_before_write BEFORE INSERT OR UPDATE ON titan.onboarding_product_results FOR EACH ROW EXECUTE FUNCTION titan.onboarding_product_before_write();
DROP TRIGGER IF EXISTS onboarding_events_immutable ON titan.onboarding_events;
CREATE TRIGGER onboarding_events_immutable BEFORE UPDATE OR DELETE ON titan.onboarding_events FOR EACH ROW EXECUTE FUNCTION titan.onboarding_events_immutable();

-- Least privilege.
--   titan_tenant_app      SELECT only, own organisation only. It has no write path to onboarding state.
--   titan_trusted_reader  SELECT, for the server-side progress and resume checks. The writer also needs SELECT:
--                         it must read rows before updating them (RLS applies to UPDATE), and its triggers read state.
--   titan_trusted_writer  INSERT and UPDATE on onboardings and product results (no DELETE: nothing is erased),
--                         and INSERT on events (no UPDATE or DELETE: the log is append-only).
GRANT SELECT ON titan.onboardings, titan.onboarding_product_results, titan.onboarding_events TO titan_tenant_app;
GRANT SELECT ON titan.onboardings, titan.onboarding_product_results, titan.onboarding_events TO titan_trusted_reader;
GRANT SELECT, INSERT, UPDATE ON titan.onboardings, titan.onboarding_product_results TO titan_trusted_writer;
GRANT SELECT, INSERT ON titan.onboarding_events TO titan_trusted_writer;
GRANT USAGE ON SEQUENCE titan.onboarding_events_id_seq TO titan_trusted_writer;

ALTER TABLE titan.onboardings ENABLE ROW LEVEL SECURITY;
ALTER TABLE titan.onboardings FORCE ROW LEVEL SECURITY;
CREATE POLICY onboardings_tenant_read ON titan.onboardings FOR SELECT TO titan_tenant_app
  USING (organisation_id = titan.current_organisation_id());
CREATE POLICY onboardings_trusted_read ON titan.onboardings FOR SELECT TO titan_trusted_reader, titan_trusted_writer USING (true);
CREATE POLICY onboardings_trusted_insert ON titan.onboardings FOR INSERT TO titan_trusted_writer WITH CHECK (true);
CREATE POLICY onboardings_trusted_update ON titan.onboardings FOR UPDATE TO titan_trusted_writer USING (true) WITH CHECK (true);

ALTER TABLE titan.onboarding_product_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE titan.onboarding_product_results FORCE ROW LEVEL SECURITY;
CREATE POLICY onboarding_product_results_tenant_read ON titan.onboarding_product_results FOR SELECT TO titan_tenant_app
  USING (organisation_id = titan.current_organisation_id());
CREATE POLICY onboarding_product_results_trusted_read ON titan.onboarding_product_results FOR SELECT TO titan_trusted_reader, titan_trusted_writer USING (true);
CREATE POLICY onboarding_product_results_trusted_insert ON titan.onboarding_product_results FOR INSERT TO titan_trusted_writer WITH CHECK (true);
CREATE POLICY onboarding_product_results_trusted_update ON titan.onboarding_product_results FOR UPDATE TO titan_trusted_writer USING (true) WITH CHECK (true);

ALTER TABLE titan.onboarding_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE titan.onboarding_events FORCE ROW LEVEL SECURITY;
CREATE POLICY onboarding_events_tenant_read ON titan.onboarding_events FOR SELECT TO titan_tenant_app
  USING (organisation_id = titan.current_organisation_id());
CREATE POLICY onboarding_events_trusted_read ON titan.onboarding_events FOR SELECT TO titan_trusted_reader, titan_trusted_writer USING (true);
CREATE POLICY onboarding_events_trusted_insert ON titan.onboarding_events FOR INSERT TO titan_trusted_writer WITH CHECK (true);

COMMIT;
