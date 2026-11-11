# Shared company migration ownership

PR #46 remains the authority for company, identity, membership, entitlement
and app mapping DDL; config-engine may reference but must not duplicate that
canonical migration. Any update to that PR must be reviewed and repinned by SHA.
Issue #43 owns forward-only production ordering and approval. The added CI job
provides evidence against one immutable candidate, never permission to enable
the production configuration route.
