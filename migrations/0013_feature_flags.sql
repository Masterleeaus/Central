-- Centrally governed configuration and feature flags (issue #38).
-- Applied after 0009. 0001 to 0009 are not edited. Versions 0010, 0011, 0012 and 0014 are
-- reserved by other passes and are not present in this repository.
--
-- Scope rows (titan.feature_flags), one per (product, environment, flag_key, organisation_id):
--   organisation_id IS NULL   global row. Serves `value` to every organisation, to the organisations
--                             in `cohort`, or to the bucket below `rollout_percent`. Otherwise the
--                             declared default applies.
--   organisation_id NOT NULL  temporary override for one organisation. expires_at is required and
--                             cohort and rollout are not allowed on override rows.
-- The declared type, allowed values, default and owner are copies of the code registry
-- (packages/control-plane/src/feature-flags.ts). The CHECK constraints below enforce the type and
-- allowed-value rules in the database, independently of the application.
--
-- Changes are audited by trigger, not by application discipline:
--   * every INSERT and UPDATE writes a titan.feature_flag_history row in the same transaction;
--   * the actor and reason come from transaction-local settings titan.change_actor and
--     titan.change_reason; a change without them is refused;
--   * history is append-only: UPDATE, DELETE and TRUNCATE on it are refused by trigger;
--   * the revision must advance by exactly one on each UPDATE, and the scope is immutable.
-- Rollback is titan.feature_flag_rollback(), which restores the values of a history revision as a
-- new revision and records it as action 'rollback'.
--
-- A superuser or the table owner can disable triggers. The application must not connect as either.
BEGIN;

-- Allowed-value shape per declared type.
--   boolean: [true, false]
--   enum:    non-empty array of distinct strings (1 to 64 characters, at most 100 values)
--   integer: {"min": <integer>, "max": <integer>} with min <= max, both within 15 digits
CREATE OR REPLACE FUNCTION titan.ff_allowed_values_ok(p_type text, p_allowed jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  n integer;
  lo text;
  hi text;
BEGIN
  IF p_allowed IS NULL THEN
    RETURN false;
  END IF;
  IF p_type = 'boolean' THEN
    RETURN p_allowed = '[true, false]'::jsonb;
  ELSIF p_type = 'enum' THEN
    IF jsonb_typeof(p_allowed) <> 'array' THEN
      RETURN false;
    END IF;
    n := jsonb_array_length(p_allowed);
    IF n < 1 OR n > 100 THEN
      RETURN false;
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_allowed) AS e
      WHERE jsonb_typeof(e) <> 'string' OR length(e #>> '{}') NOT BETWEEN 1 AND 64
    ) THEN
      RETURN false;
    END IF;
    RETURN (SELECT count(DISTINCT e) FROM jsonb_array_elements_text(p_allowed) AS e) = n;
  ELSIF p_type = 'integer' THEN
    IF jsonb_typeof(p_allowed) <> 'object' THEN
      RETURN false;
    END IF;
    IF (SELECT count(*) FROM jsonb_object_keys(p_allowed)) <> 2 OR NOT (p_allowed ? 'min' AND p_allowed ? 'max') THEN
      RETURN false;
    END IF;
    IF jsonb_typeof(p_allowed->'min') <> 'number' OR jsonb_typeof(p_allowed->'max') <> 'number' THEN
      RETURN false;
    END IF;
    lo := p_allowed->>'min';
    hi := p_allowed->>'max';
    IF lo !~ '^-?[0-9]{1,15}$' OR hi !~ '^-?[0-9]{1,15}$' THEN
      RETURN false;
    END IF;
    RETURN lo::bigint <= hi::bigint;
  END IF;
  RETURN false;
END
$$;

-- A value that is valid for the declared type and allowed values.
CREATE OR REPLACE FUNCTION titan.ff_value_ok(p_type text, p_allowed jsonb, p_value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_value IS NULL OR NOT titan.ff_allowed_values_ok(p_type, p_allowed) THEN
    RETURN false;
  END IF;
  IF p_type = 'boolean' THEN
    RETURN jsonb_typeof(p_value) = 'boolean';
  ELSIF p_type = 'enum' THEN
    RETURN jsonb_typeof(p_value) = 'string' AND p_allowed @> jsonb_build_array(p_value);
  ELSIF p_type = 'integer' THEN
    IF jsonb_typeof(p_value) <> 'number' OR (p_value #>> '{}') !~ '^-?[0-9]{1,15}$' THEN
      RETURN false;
    END IF;
    RETURN (p_value #>> '{}')::bigint BETWEEN (p_allowed->>'min')::bigint AND (p_allowed->>'max')::bigint;
  END IF;
  RETURN false;
END
$$;

CREATE TABLE IF NOT EXISTS titan.feature_flags (
  product text NOT NULL CHECK (product IN ('sorted', 'supercharged', 'lms', 'central')),
  environment text NOT NULL CHECK (environment IN ('development', 'staging', 'production')),
  flag_key text NOT NULL CHECK (flag_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  organisation_id uuid REFERENCES titan.organisations(id),
  flag_type text NOT NULL CHECK (flag_type IN ('boolean', 'enum', 'integer')),
  allowed_values jsonb NOT NULL,
  default_value jsonb NOT NULL,
  owner text NOT NULL CHECK (length(btrim(owner)) BETWEEN 1 AND 200),
  value jsonb NOT NULL,
  rollout_percent integer CHECK (rollout_percent BETWEEN 0 AND 100),
  cohort text CHECK (cohort ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  expires_at timestamptz,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feature_flags_scope_key UNIQUE NULLS NOT DISTINCT (product, environment, flag_key, organisation_id),
  CONSTRAINT feature_flags_allowed_values_ok CHECK (titan.ff_allowed_values_ok(flag_type, allowed_values) IS TRUE),
  CONSTRAINT feature_flags_default_ok CHECK (titan.ff_value_ok(flag_type, allowed_values, default_value) IS TRUE),
  CONSTRAINT feature_flags_value_ok CHECK (titan.ff_value_ok(flag_type, allowed_values, value) IS TRUE),
  CONSTRAINT feature_flags_one_targeting_rule CHECK (rollout_percent IS NULL OR cohort IS NULL),
  CONSTRAINT feature_flags_override_expires CHECK (organisation_id IS NULL OR expires_at IS NOT NULL),
  CONSTRAINT feature_flags_override_no_targeting CHECK (organisation_id IS NULL OR (rollout_percent IS NULL AND cohort IS NULL))
);

CREATE TABLE IF NOT EXISTS titan.feature_flag_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product text NOT NULL CHECK (product IN ('sorted', 'supercharged', 'lms', 'central')),
  environment text NOT NULL CHECK (environment IN ('development', 'staging', 'production')),
  flag_key text NOT NULL CHECK (flag_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  organisation_id uuid REFERENCES titan.organisations(id),
  revision bigint NOT NULL CHECK (revision > 0),
  action text NOT NULL CHECK (action IN ('create', 'set', 'rollback')),
  rollback_to_revision bigint CHECK (rollback_to_revision > 0),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  actor text NOT NULL CHECK (length(btrim(actor)) BETWEEN 1 AND 200),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feature_flag_history_revision_key UNIQUE NULLS NOT DISTINCT (product, environment, flag_key, organisation_id, revision),
  CONSTRAINT feature_flag_history_rollback_shape CHECK ((action = 'rollback') = (rollback_to_revision IS NOT NULL)),
  CONSTRAINT feature_flag_history_snapshot_ok CHECK (
    titan.ff_allowed_values_ok(snapshot->>'flag_type', snapshot->'allowed_values') IS TRUE
    AND titan.ff_value_ok(snapshot->>'flag_type', snapshot->'allowed_values', snapshot->'value') IS TRUE
    AND titan.ff_value_ok(snapshot->>'flag_type', snapshot->'allowed_values', snapshot->'default_value') IS TRUE
  )
);

-- History is append-only.
CREATE OR REPLACE FUNCTION titan.feature_flag_history_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'titan.feature_flag_history is append-only: % is refused', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;

DROP TRIGGER IF EXISTS feature_flag_history_no_update ON titan.feature_flag_history;
CREATE TRIGGER feature_flag_history_no_update BEFORE UPDATE ON titan.feature_flag_history
  FOR EACH ROW EXECUTE FUNCTION titan.feature_flag_history_append_only();
DROP TRIGGER IF EXISTS feature_flag_history_no_delete ON titan.feature_flag_history;
CREATE TRIGGER feature_flag_history_no_delete BEFORE DELETE ON titan.feature_flag_history
  FOR EACH ROW EXECUTE FUNCTION titan.feature_flag_history_append_only();
DROP TRIGGER IF EXISTS feature_flag_history_no_truncate ON titan.feature_flag_history;
CREATE TRIGGER feature_flag_history_no_truncate BEFORE TRUNCATE ON titan.feature_flag_history
  FOR EACH STATEMENT EXECUTE FUNCTION titan.feature_flag_history_append_only();

-- Scope identity is immutable and the revision advances by exactly one.
CREATE OR REPLACE FUNCTION titan.feature_flag_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.revision <> 1 THEN
      RAISE EXCEPTION 'a feature flag scope starts at revision 1' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.product <> OLD.product OR NEW.environment <> OLD.environment OR NEW.flag_key <> OLD.flag_key
     OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id THEN
    RAISE EXCEPTION 'feature flag scope is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'feature flag revision must advance by one (have %, got %)', OLD.revision, NEW.revision
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

-- Every change is recorded in the same transaction, with actor and reason.
CREATE OR REPLACE FUNCTION titan.feature_flag_audit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_actor text := nullif(btrim(current_setting('titan.change_actor', true)), '');
  v_reason text := nullif(btrim(current_setting('titan.change_reason', true)), '');
  v_rollback text := nullif(btrim(current_setting('titan.change_rollback_to', true)), '');
  v_action text;
BEGIN
  IF v_actor IS NULL OR v_reason IS NULL THEN
    RAISE EXCEPTION 'a feature flag change requires titan.change_actor and titan.change_reason'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    v_action := 'create';
  ELSIF v_rollback IS NOT NULL THEN
    v_action := 'rollback';
  ELSE
    v_action := 'set';
  END IF;
  INSERT INTO titan.feature_flag_history (
    product, environment, flag_key, organisation_id, revision, action, rollback_to_revision,
    snapshot, actor, reason
  ) VALUES (
    NEW.product, NEW.environment, NEW.flag_key, NEW.organisation_id, NEW.revision, v_action,
    CASE WHEN v_action = 'rollback' THEN v_rollback::bigint END,
    jsonb_build_object(
      'flag_type', NEW.flag_type,
      'allowed_values', NEW.allowed_values,
      'default_value', NEW.default_value,
      'owner', NEW.owner,
      'value', NEW.value,
      'rollout_percent', NEW.rollout_percent,
      'cohort', NEW.cohort,
      'expires_at', NEW.expires_at
    ),
    v_actor,
    v_reason
  );
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS feature_flags_guard ON titan.feature_flags;
CREATE TRIGGER feature_flags_guard BEFORE INSERT OR UPDATE ON titan.feature_flags
  FOR EACH ROW EXECUTE FUNCTION titan.feature_flag_guard();
DROP TRIGGER IF EXISTS feature_flags_audit ON titan.feature_flags;
CREATE TRIGGER feature_flags_audit AFTER INSERT OR UPDATE ON titan.feature_flags
  FOR EACH ROW EXECUTE FUNCTION titan.feature_flag_audit();

-- Restores the values recorded at p_to_revision as a new revision. Refuses a stale expected revision,
-- an unknown history revision, a snapshot whose recorded expiry has passed, and an organisation
-- override snapshot that has no expiry.
CREATE OR REPLACE FUNCTION titan.feature_flag_rollback(
  p_product text,
  p_environment text,
  p_flag_key text,
  p_organisation_id uuid,
  p_expected_revision bigint,
  p_to_revision bigint,
  p_actor text,
  p_reason text
) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  v_snap jsonb;
  v_new bigint;
BEGIN
  SELECT h.snapshot INTO v_snap
    FROM titan.feature_flag_history AS h
   WHERE h.product = p_product AND h.environment = p_environment AND h.flag_key = p_flag_key
     AND h.organisation_id IS NOT DISTINCT FROM p_organisation_id AND h.revision = p_to_revision;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no history revision % for this feature flag scope', p_to_revision
      USING ERRCODE = 'no_data_found';
  END IF;
  IF p_organisation_id IS NOT NULL AND (v_snap->>'expires_at') IS NULL THEN
    RAISE EXCEPTION 'cannot roll back to an override without an expiry'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (v_snap->>'expires_at') IS NOT NULL AND (v_snap->>'expires_at')::timestamptz <= now() THEN
    RAISE EXCEPTION 'cannot roll back to a revision whose expiry has passed'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('titan.change_actor', p_actor, true);
  PERFORM set_config('titan.change_reason', p_reason, true);
  PERFORM set_config('titan.change_rollback_to', p_to_revision::text, true);

  UPDATE titan.feature_flags AS f
     SET value = v_snap->'value',
         rollout_percent = (v_snap->>'rollout_percent')::integer,
         cohort = v_snap->>'cohort',
         expires_at = (v_snap->>'expires_at')::timestamptz,
         revision = f.revision + 1
   WHERE f.product = p_product AND f.environment = p_environment AND f.flag_key = p_flag_key
     AND f.organisation_id IS NOT DISTINCT FROM p_organisation_id
     AND f.revision = p_expected_revision
  RETURNING f.revision INTO v_new;

  PERFORM set_config('titan.change_rollback_to', '', true);
  IF v_new IS NULL THEN
    RAISE EXCEPTION 'stale revision: expected revision % does not match the current scope', p_expected_revision
      USING ERRCODE = 'serialization_failure';
  END IF;
  RETURN v_new;
END
$$;

-- Grants follow 0007 and 0008: only the trusted roles, never the login role or a browser-facing role.
-- History is readable and insertable (through the audit trigger) by the writer, and nothing else.
REVOKE ALL ON titan.feature_flags, titan.feature_flag_history FROM PUBLIC;
GRANT SELECT ON titan.feature_flags, titan.feature_flag_history TO titan_trusted_reader;
GRANT SELECT, INSERT, UPDATE ON titan.feature_flags TO titan_trusted_writer;
GRANT SELECT, INSERT ON titan.feature_flag_history TO titan_trusted_writer;
REVOKE ALL ON FUNCTION titan.feature_flag_rollback(text, text, text, uuid, bigint, bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION titan.feature_flag_rollback(text, text, text, uuid, bigint, bigint, text, text) TO titan_trusted_writer;

COMMIT;
