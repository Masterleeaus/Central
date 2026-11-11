-- Forward-only registration of Scheduled in the canonical Titan product IDs.
-- No tenant data is modified. Keep 0001-0012 checksum-locked.
BEGIN;

ALTER TABLE titan.application_entitlements
  DROP CONSTRAINT application_entitlements_application_id_check;
ALTER TABLE titan.application_entitlements
  ADD CONSTRAINT application_entitlements_application_id_check
  CHECK (application_id IN ('central', 'sorted', 'lms', 'supercharged', 'scheduled'));

ALTER TABLE titan.application_company_links
  DROP CONSTRAINT application_company_links_application_id_check;
ALTER TABLE titan.application_company_links
  ADD CONSTRAINT application_company_links_application_id_check
  CHECK (application_id IN ('sorted', 'lms', 'supercharged', 'scheduled'));

ALTER TABLE titan.application_user_links
  DROP CONSTRAINT application_user_links_application_id_check;
ALTER TABLE titan.application_user_links
  ADD CONSTRAINT application_user_links_application_id_check
  CHECK (application_id IN ('sorted', 'lms', 'supercharged', 'scheduled'));

COMMIT;
