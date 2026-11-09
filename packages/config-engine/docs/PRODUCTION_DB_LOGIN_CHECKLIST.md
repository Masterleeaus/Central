# Production login separation checklist

- Consolidate draft config/company migrations through Issue #43 migration authority.
- Provision each credential separately from a managed secret source.
- Never use the fixed disposable CI credentials outside ephemeral CI.
- Verify each database login has no SUPERUSER, BYPASSRLS, inheritance or DDL powers.
- Test cross-service SET ROLE denial from independently authenticated sessions.
- Prohibit direct product/browser SQL access; custom company GUCs are forgeable.
- Enforce connection limits, TLS, credential rotation, and audit monitoring.
- Keep the configuration HTTP endpoint disabled until real Logto and company
  grant integration have been verified.
