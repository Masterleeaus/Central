\set ON_ERROR_STOP on
DO $$
BEGIN
 IF (SELECT count(*) FROM titan.companies WHERE id IN ('550e8400-e29b-41d4-a716-446655440000','550e8400-e29b-41d4-a716-446655440003') AND status='active')<>2
 THEN RAISE EXCEPTION 'E2E companies not active'; END IF;
END $$;
