# Provisional machine-service grants

Draft 0004 creates a tenant-grant table and a restricted read-only role for
a server-owned service grant resolver. It accepts verified client_id,
product and environment, requires exactly one current active company grant,
and rejects ambiguous or missing associations.

**Not production-ready:** The company_id UUID has no FK to the canonical
companies table because Issue #43 has not resolved the shared schema. Do not
apply the isolated SQL as a production migration or expose registry SQL to
untrusted clients. Revocation, role provisioning and migration ownership must
be reconciled with Central's real shared database.
