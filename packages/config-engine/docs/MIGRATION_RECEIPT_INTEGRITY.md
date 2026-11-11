# Pass 21: canonical migration checksum receipt

PR #46 defines titan.schema_migrations but raw psql application did not
record anything. The pinned upstream integration now computes SHA-256 of the
reviewed migration's original bytes and records it after successful application
in a separate disposable CI database.

The restricted config reader may SELECT migration ID and SHA-256 only. Central
will refuse opt-in config startup unless the approved ID and expected source
checksum match exactly one database receipt. A missing, altered or malformed
receipt denies access and never triggers automatic database repair.

An operator with table-owner privileges can alter the ledger, so deployment
also needs restricted schema ownership, signed release manifests, approved
forward-only migrations, backup controls and security signoff under #43.
