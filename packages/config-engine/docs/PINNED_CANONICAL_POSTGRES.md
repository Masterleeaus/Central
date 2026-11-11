# Actual canonical PostgreSQL migration verification

CI checks out the exact SHA 3c026a42069d60cdb9315ddd8f7ca162a44a10c7 from the separately owned PR #46,
applies its original unmodified database/migrations/0001_shared_company_core.sql,
and runs configuration SQL 0001–0008 in order in a separate disposable DB.
Only synthetic records are inserted into the real canonical tables.

CI verifies memberships, entitlements, link mappings, canonical FKs and grant
integrity, then performs four independently authenticated PostgreSQL login
checks, real signed-JWT company flag reads and restricted schema startup checks.
The pinned checkout does NOT merge PR #46 or approve production migration #43.
