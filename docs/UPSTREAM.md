# Upstream Logto

Status: Logto is the upstream identity service. Its source is **not vendored** in this repository, and this repository does not contain a `logto-master/` directory. The Titan Central extension lives in its own directories and must not modify upstream files (ADR-001).

## What the audit recorded

Source: `docs/records/pass/PASS01_SOURCE_AUDIT.md`, `docs/records/pass/PASS15_DEPLOYMENT_RUNBOOK.md`.

| Item | Recorded value |
| --- | --- |
| Upstream | Logto (`@logto/root`) |
| Core version | `@logto/core` **1.45.0**. Other workspace packages may have different versions. Do not treat every package as 1.45.0. |
| Licence | MPL-2.0 (retained verbatim in the upstream source) |
| Artifact audited | Source ZIP, SHA-256 `dcaccecd1cc6696f1dd78dc21ee482268960c3a13360e028dced50827cd3a0f5` |
| Git metadata | None in the ZIP. **No upstream commit SHA has been verified.** |

The ZIP hash identifies the audited artifact. It is not a Git commit SHA and does not pin an upstream release.

## Pinning process

Do this before any production maintenance. Record each result in the table below.

1. Obtain the release tag from the official upstream repository (`logto-io/logto`). Do not use a mirror or a copy from a ZIP.
2. Resolve the tag to its commit: `git rev-parse '<tag>^{commit}'`. Record the full 40-character SHA.
3. Confirm `packages/core/package.json` at that commit reports the version being pinned, and compare its source tree with the audited ZIP. Document any difference and stop if it is not explained.
4. Check out that exact commit into a separate directory, outside this repository. Pass that path to the gate as `preflight.py --upstream <path>`.
5. Do not edit upstream files. Any change needs a new ADR and a deliberate, separately recorded fork.

| Field | Value |
| --- | --- |
| Release tag | _not yet recorded_ |
| Commit SHA (full) | _not yet recorded_ |
| Verified by / date | _not yet recorded_ |

## PostgreSQL requirement

- The live server runs PostgreSQL **13.23**. `docs/records/pass/PASS15_DEPLOYMENT_RUNBOOK.md` treats it as **not a supported foundation** for current Logto. Do not run Logto or Titan Central against it, and do not migrate it in place.
- The example Compose file in the upstream tree uses `postgres:17-alpine`. It is marked demonstration only. Its version alone is not a proven minimum.
- The exact minimum supported version must be confirmed against the upstream documentation and database constraints for the pinned release. Then test Logto migrations in an isolated instance.
- Logto and `titan_central` must use separate databases with restricted service roles (ADR-003). No cross-database foreign keys.

## Outside this repository

The following steps cannot be done from this repository. They are tracked under issue #24:

- Installing an isolated, supported PostgreSQL instance.
- Deploying the pinned Logto release to a staging origin.
- Verifying discovery, JWKS and management scopes, and creating the three confidential OIDC clients.
- Running the sign-in, logout and rollback tests before any cutover.

Until those steps are done and recorded, `deploy/preflight.py` keeps `supported_postgres`, `real_logto_verified` and related gates set to `false`, and the release is not production-installable.
