-- DRAFT: config-specific RLS until one shared migration authority (#43).
-- Custom session GUCs must be set only by authenticated trusted service code.
BEGIN;
CREATE FUNCTION titan_config.scope_allowed(k text,v text)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN k='environment' THEN v='*'
 WHEN k='company' THEN nullif(current_setting('titan_config.company_id',true),'') IS NOT NULL
  AND v=current_setting('titan_config.company_id',true)
 WHEN k='cohort' THEN v=ANY(COALESCE(
   string_to_array(nullif(current_setting('titan_config.cohorts',true),''),','),ARRAY[]::text[]))
 ELSE false END;
$$;
REVOKE ALL ON FUNCTION titan_config.scope_allowed(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION titan_config.scope_allowed(text,text) TO titan_config_reader,titan_config_writer;
ALTER TABLE titan_config.scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE titan_config.revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE titan_config.audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE titan_config.scopes FORCE ROW LEVEL SECURITY;
ALTER TABLE titan_config.revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE titan_config.audit FORCE ROW LEVEL SECURITY;
CREATE POLICY scope_reader ON titan_config.scopes FOR SELECT TO titan_config_reader,titan_config_writer
 USING (titan_config.scope_allowed(kind,scope));
CREATE POLICY scope_writer_insert ON titan_config.scopes FOR INSERT TO titan_config_writer
 WITH CHECK (titan_config.scope_allowed(kind,scope));
CREATE POLICY scope_writer_update ON titan_config.scopes FOR UPDATE TO titan_config_writer
 USING (titan_config.scope_allowed(kind,scope))
 WITH CHECK (titan_config.scope_allowed(kind,scope));
CREATE POLICY revision_reader ON titan_config.revisions FOR SELECT TO titan_config_reader,titan_config_writer
 USING (titan_config.scope_allowed(kind,scope));
CREATE POLICY revision_writer_insert ON titan_config.revisions FOR INSERT TO titan_config_writer
 WITH CHECK (titan_config.scope_allowed(kind,scope));
CREATE POLICY audit_writer_insert ON titan_config.audit FOR INSERT TO titan_config_writer
 WITH CHECK (titan_config.scope_allowed(kind,scope));
COMMIT;
