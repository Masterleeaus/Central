/** Canonical lookup of Logto identifiers for Central UUIDs (issue #37). Read-only, one transaction per lookup,
 * run as titan_trusted_reader. TrustedProvisioningService uses it so that commands never choose Logto subjects. */
import type { SqlPool } from './postgres.js';
import type { GetCanonicalLogtoId } from './trusted-provisioning.js';
export declare function createPostgresCanonicalResolver(pool: SqlPool): GetCanonicalLogtoId;
