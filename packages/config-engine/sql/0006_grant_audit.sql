-- DRAFT ONLY, ordered after 0005. Never apply outside coordinated #43 migrations.
BEGIN;
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='titan_config_grant_writer') THEN
  CREATE ROLE titan_config_grant_writer NOLOGIN NOINHERIT;
 END IF;
END $$;
CREATE TABLE titan_config.service_grant_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 grant_id bigint NOT NULL REFERENCES titan_config.service_company_grants(id) ON DELETE RESTRICT,
 old_state text, new_state text NOT NULL,
 old_revision bigint, new_revision bigint NOT NULL,
 actor text NOT NULL, operation text NOT NULL CHECK(operation IN ('INSERT','UPDATE')),
 changed_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON titan_config.service_grant_audit FROM PUBLIC;
GRANT USAGE ON SCHEMA titan_config TO titan_config_grant_writer;
GRANT SELECT,INSERT ON titan_config.service_company_grants TO titan_config_grant_writer;
GRANT UPDATE(state,expires_at,revision,cohorts) ON titan_config.service_company_grants TO titan_config_grant_writer;
GRANT USAGE ON SEQUENCE titan_config.service_company_grants_id_seq TO titan_config_grant_writer;
CREATE FUNCTION titan_config.record_service_grant_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,titan_config AS $body$
DECLARE actor_label text;
BEGIN
 actor_label:=nullif(current_setting('titan_config.grant_actor',true),'');
 IF current_setting('role',true)='titan_config_grant_writer'
  AND (actor_label IS NULL OR length(actor_label)>256) THEN
  RAISE EXCEPTION 'grant actor required' USING ERRCODE='42501';
 END IF;
 IF TG_OP='UPDATE' AND (NEW.revision<>OLD.revision+1 OR NEW.id<>OLD.id
  OR NEW.client_id<>OLD.client_id OR NEW.company_id<>OLD.company_id
  OR NEW.product<>OLD.product OR NEW.environment<>OLD.environment) THEN
  RAISE EXCEPTION 'invalid grant transition';
 END IF;
 IF TG_OP='INSERT' AND NEW.revision<>1 THEN
  RAISE EXCEPTION 'grant must begin at revision 1';
 END IF;
 INSERT INTO titan_config.service_grant_audit
 (grant_id,old_state,new_state,old_revision,new_revision,actor,operation)
 VALUES(NEW.id,CASE WHEN TG_OP='UPDATE' THEN OLD.state ELSE NULL END,
  NEW.state,CASE WHEN TG_OP='UPDATE' THEN OLD.revision ELSE NULL END,
  NEW.revision,coalesce(actor_label,'migration-test-owner'),TG_OP);
 RETURN NEW;
END $body$;
REVOKE ALL ON FUNCTION titan_config.record_service_grant_change() FROM PUBLIC;
CREATE TRIGGER config_service_grant_audit_trigger AFTER INSERT OR UPDATE
 ON titan_config.service_company_grants FOR EACH ROW
 EXECUTE FUNCTION titan_config.record_service_grant_change();
-- Grants to audit and history tables are intentionally absent for the writer role.
COMMIT;
