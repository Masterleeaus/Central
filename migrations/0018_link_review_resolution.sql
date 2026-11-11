-- REVIEW BEFORE APPLYING. Issue #37: reviewed resolution of account link conflicts.
-- Applied after 0014. Written only by CentralProvisioner through the link_review_resolve command.
--
-- 1. link_reviews gains a resolution: state moves from 'open' to 'approved' or 'rejected' once, with the
--    reviewer, the reason and the request ID that resolved it. A resolved row is never reopened.
-- 2. provisioning_audit gains a reason column (used by link_review_resolve only) and the new kind.
-- 3. titan_trusted_writer may update only the resolution columns of link_reviews.
BEGIN;

ALTER TABLE titan.link_reviews DROP CONSTRAINT IF EXISTS link_reviews_state_check;
ALTER TABLE titan.link_reviews ADD CONSTRAINT link_reviews_state_check
  CHECK (state IN ('open','approved','rejected'));

ALTER TABLE titan.link_reviews
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by text,
  ADD COLUMN IF NOT EXISTS resolution_reason text CHECK (resolution_reason IS NULL OR length(resolution_reason) BETWEEN 1 AND 500),
  ADD COLUMN IF NOT EXISTS resolution_request_id uuid;

ALTER TABLE titan.link_reviews DROP CONSTRAINT IF EXISTS link_reviews_resolution_consistent;
ALTER TABLE titan.link_reviews ADD CONSTRAINT link_reviews_resolution_consistent CHECK (
  (state = 'open' AND resolved_at IS NULL AND resolved_by IS NULL AND resolution_reason IS NULL AND resolution_request_id IS NULL)
  OR (state IN ('approved','rejected') AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL
      AND resolution_reason IS NOT NULL AND resolution_request_id IS NOT NULL)
);

-- A resolved review is final: no update of any kind, whatever the writer's grants. The application checks the
-- state first, so an identical retry never reaches this trigger.
CREATE OR REPLACE FUNCTION titan.link_reviews_refuse_resolved_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state <> 'open' THEN
    RAISE EXCEPTION 'link review % is already resolved and cannot change', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS link_reviews_resolved_immutable ON titan.link_reviews;
CREATE TRIGGER link_reviews_resolved_immutable BEFORE UPDATE ON titan.link_reviews
  FOR EACH ROW EXECUTE FUNCTION titan.link_reviews_refuse_resolved_change();

ALTER TABLE titan.provisioning_audit ADD COLUMN IF NOT EXISTS reason text
  CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 500);

ALTER TABLE titan.provisioning_audit DROP CONSTRAINT IF EXISTS provisioning_audit_command_kind_check;
ALTER TABLE titan.provisioning_audit ADD CONSTRAINT provisioning_audit_command_kind_check
  CHECK (command_kind IN ('identity','organisation','membership','entitlement','link','membership_update','entitlement_update','link_revoke','link_relink','link_review_resolve'));

GRANT UPDATE (state, resolved_at, resolved_by, resolution_reason, resolution_request_id) ON titan.link_reviews TO titan_trusted_writer;

COMMIT;
