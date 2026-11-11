# Actual database role check

CI runs SELECT under the two NOLOGIN database roles via SET LOCAL ROLE,
then executes disallowed DML and requires a non-zero PostgreSQL exit code:
reader cannot insert definitions, writer cannot update immutable revisions,
and writer cannot delete audit events.

These assertions are in addition to pg_catalog grant inspections.
Production role provisioning, SQL-level tenant enforcement and canonical
company membership are still pending Issue #43.
