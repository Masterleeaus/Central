-- Migration 0029: allow 'scheduled' as an activity source product (Scheduled joins Central's activity history).
-- Applied after 0028. Migrations 0001 to 0028 are not edited.
--
-- Scope of change:
--   * Replaces the source_product CHECK on titan.activity_events (created in migration 0011) so that it also
--     accepts 'scheduled'. The accepted set is sorted, supercharged, lms, central, scheduled.
--   * Forward only, and widening only: every existing row already satisfies the new CHECK, so no data is
--     rewritten. No grant, policy, trigger or index changes.
--   * The append-only trigger from 0011 covers UPDATE, DELETE and TRUNCATE only, so ALTER TABLE on the
--     constraint does not touch it.
--   * Removing 'scheduled' again would need every 'scheduled' row to be gone first, and append-only rows cannot be
--     deleted outside the 0028 purge window. Treat a rollback as an operator decision, not a routine step.
BEGIN;

ALTER TABLE titan.activity_events DROP CONSTRAINT activity_events_source_product_check;
ALTER TABLE titan.activity_events ADD CONSTRAINT activity_events_source_product_check
  CHECK (source_product IN ('sorted', 'supercharged', 'lms', 'central', 'scheduled'));

COMMIT;
