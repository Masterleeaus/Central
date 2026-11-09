\set ON_ERROR_STOP on
DO $$ BEGIN
 IF has_table_privilege('titan_config_reader','titan_config.revisions','INSERT') THEN RAISE EXCEPTION 'reader can insert'; END IF;
 IF has_table_privilege('titan_config_writer','titan_config.audit','DELETE') THEN RAISE EXCEPTION 'writer can delete audit'; END IF;
 IF NOT has_table_privilege('titan_config_writer','titan_config.audit','INSERT') THEN RAISE EXCEPTION 'writer cannot append audit'; END IF;
 IF has_table_privilege('titan_config_writer','titan_config.revisions','UPDATE')
 THEN RAISE EXCEPTION 'writer can rewrite immutable revision'; END IF;
 IF has_table_privilege('titan_config_writer','titan_config.revisions','TRUNCATE')
 THEN RAISE EXCEPTION 'writer can truncate revision history'; END IF;
 IF has_table_privilege('titan_config_reader','titan_config.audit','SELECT')
 THEN RAISE EXCEPTION 'reader can inspect audit history without privilege'; END IF;
END $;
