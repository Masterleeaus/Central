/** Operator (admin) plane configuration. Read from the environment at startup only.
 * Off unless TITAN_OPERATOR_ORGANISATION_ID and TITAN_OPERATOR_ROLE_IDS are both set. Once either is set,
 * every operator setting must be valid or startup throws. Error messages name variables, never values. */
import { createLogtoManagementTokenSupplier, LogtoManagementVerifier, createTitanOidcRegistrationPlans, buildProductRegistry, originsForLegacyIds } from '../../../packages/control-plane/dist/index.js';
import {
  CentralProvisioner, LinkAssertionVerifier, TrustedProvisioningService, verifyLinkCommand,
  createPostgresLinkNonceStore, createPostgresCanonicalResolver,
} from '../../../packages/control-plane/dist/index.js';
import { createAdminHandler, createLogtoOperatorAuthoriser, OPERATOR_COMMAND_KINDS } from './admin.mjs';
import { readOrganisationAccess } from '../../../packages/control-plane/dist/administration.js';
import { timedFetch } from './metrics.mjs';
import { createFlagChangeHandler } from './config-admin.mjs';

const ID = /^[A-Za-z0-9_-]{1,256}$/;
const PLACEHOLDER = 'REPLACE_ME';
const present = v => v !== undefined && v !== '';

function logtoId(name, value) {
  if (typeof value !== 'string' || value === PLACEHOLDER || !ID.test(value)) throw new Error(`invalid ${name}`);
  return value;
}
function plainValue(name, value) {
  if (typeof value !== 'string' || value.length === 0 || value === PLACEHOLDER) throw new Error(`${name} must be set`);
  return value;
}
function httpsOrigin(name, value) {
  let url;
  try { url = new URL(plainValue(name, value)); } catch { throw new Error(`invalid ${name}`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error(`invalid ${name}`);
  return url.origin;
}

/** Returns the parsed operator settings, or null when the operator plane is off. */
export function readOperatorConfig(env) {
  const orgRaw = env.TITAN_OPERATOR_ORGANISATION_ID;
  const rolesRaw = env.TITAN_OPERATOR_ROLE_IDS;
  if (!present(orgRaw) && !present(rolesRaw)) return null;
  if (!present(orgRaw) || !present(rolesRaw)) throw new Error('TITAN_OPERATOR_ORGANISATION_ID and TITAN_OPERATOR_ROLE_IDS must be set together');
  const organisationId = logtoId('TITAN_OPERATOR_ORGANISATION_ID', orgRaw);
  if (typeof rolesRaw !== 'string') throw new Error('invalid TITAN_OPERATOR_ROLE_IDS');
  const roleIds = rolesRaw.split(',').map(s => s.trim());
  if (roleIds.length < 1 || roleIds.length > 32 || new Set(roleIds).size !== roleIds.length || !roleIds.every(r => r !== PLACEHOLDER && ID.test(r)))
    throw new Error('invalid TITAN_OPERATOR_ROLE_IDS');
  return { organisationId, roleIds };
}

/** TITAN_OPERATOR_FLAG_CHANGES=1 enables POST /v1/admin/flags/change. Unset or 0 keeps the route off (404). */
export function readFlagChangeSetting(env) {
  const raw = env.TITAN_OPERATOR_FLAG_CHANGES;
  if (raw === undefined || raw === '' || raw === '0') return false;
  if (raw === '1') return true;
  throw new Error('invalid TITAN_OPERATOR_FLAG_CHANGES');
}

/**
 * Product registry from operator configuration (issue #29). Runs at every startup, so an invalid configuration
 * fails startup even when the operator plane is off. Names only in messages, never values.
 *   TITAN_FIELD_ORIGIN, TITAN_DESK_ORIGIN, TITAN_ACADEMY_ORIGIN: product service origins (legacy variable names,
 *     mapped to Sorted, Supercharged and LMS). Set all three together or none.
 *   TITAN_PRODUCT_TRUSTED_ORIGINS: comma-separated operator allowlist. Required whenever an origin is set.
 * With nothing set, the registry is returned with no origins and nothing is validated against the network.
 */
export const PRODUCT_ORIGIN_VARIABLES = Object.freeze({ sorted: 'TITAN_FIELD_ORIGIN', supercharged: 'TITAN_DESK_ORIGIN', lms: 'TITAN_ACADEMY_ORIGIN' });
export const PRODUCT_TRUSTED_ORIGINS_VARIABLE = 'TITAN_PRODUCT_TRUSTED_ORIGINS';
const PRODUCT_ORIGIN_NAMES = Object.values(PRODUCT_ORIGIN_VARIABLES);

export function loadProductRegistry(env) {
  const serviceOrigins = {};
  for (const [productId, name] of Object.entries(PRODUCT_ORIGIN_VARIABLES)) {
    if (present(env[name])) serviceOrigins[productId] = env[name];
  }
  const originCount = Object.keys(serviceOrigins).length;
  const trustedRaw = env[PRODUCT_TRUSTED_ORIGINS_VARIABLE];
  if (originCount === 0 && !present(trustedRaw)) return buildProductRegistry({ serviceOrigins: {}, trustedOrigins: [] });
  if (originCount !== 0 && originCount !== PRODUCT_ORIGIN_NAMES.length) {
    throw new Error(`${PRODUCT_ORIGIN_NAMES.join(', ')} must be set together`);
  }
  if (!present(trustedRaw)) throw new Error(`${PRODUCT_TRUSTED_ORIGINS_VARIABLE} must be set when product origins are configured`);
  if (typeof trustedRaw !== 'string') throw new Error(`invalid ${PRODUCT_TRUSTED_ORIGINS_VARIABLE}`);
  const trustedOrigins = trustedRaw.split(',').map(s => s.trim());
  if (trustedOrigins.length > 16 || trustedOrigins.some(o => o === '' || o === PLACEHOLDER)) throw new Error(`invalid ${PRODUCT_TRUSTED_ORIGINS_VARIABLE}`);
  try {
    return buildProductRegistry({ serviceOrigins, trustedOrigins });
  } catch (e) {
    // Registry messages name products and rules, never the configured origin values.
    throw new Error(`invalid product origin configuration (${e.code ?? 'unknown'}): ${e.message}`);
  }
}

/** The only write path for operator commands: TrustedProvisioningService, which checks authority, Logto membership,
 * canonical IDs and the link assertion before CentralProvisioner runs. Built only when link keys are configured. */
export function createOperatorProvisioning({ pool, logto, linkKeySets }) {
  const assertionVerifier = new LinkAssertionVerifier(linkKeySets, createPostgresLinkNonceStore(pool));
  const authorize = async (actor, command) => actor?.operatorAuthorityVerified === true && OPERATOR_COMMAND_KINDS.includes(command?.kind);
  const service = new TrustedProvisioningService(
    new CentralProvisioner(pool), logto, authorize, createPostgresCanonicalResolver(pool), verifyLinkCommand(assertionVerifier),
  );
  return (actor, context, command) => service.apply(actor, context, command);
}

/** Builds the /v1/admin/ handler when the operator plane is on, otherwise returns null (route stays 404).
 * flags = { registry, store } is required only for the flag-change route. fetcher and metrics are injectable for tests. Logto calls are counted and timed through timedFetch.
 * Provisioning is wired only when both a database pool and link key sets are supplied; otherwise POST
 * /v1/admin/provision answers 503 provisioning_disabled, as it does by default. */
export function createOperatorAdmin({ env, verifyToken, metrics, logger = () => {}, fetcher, flags, pool, linkKeySets = null, productRegistry = loadProductRegistry(env) }) {
  const operator = readOperatorConfig(env);
  if (!operator) return null;
  const flagChanges = readFlagChangeSetting(env);
  if (flagChanges && !flags) throw new Error('flag registry and store required for TITAN_OPERATOR_FLAG_CHANGES');
  // Origins come only from the validated product registry (loadProductRegistry), never from raw env values here.
  let origins;
  try {
    origins = { ...originsForLegacyIds(productRegistry) };
  } catch {
    throw new Error('operator plane requires TITAN_FIELD_ORIGIN, TITAN_DESK_ORIGIN and TITAN_ACADEMY_ORIGIN to be valid product origins');
  }
  // Fail at startup, before any request, if the registration plans would be invalid.
  createTitanOidcRegistrationPlans(origins);
  const logtoOrigin = httpsOrigin('TITAN_LOGTO_MANAGEMENT_ORIGIN', env.TITAN_LOGTO_MANAGEMENT_ORIGIN);
  let supplier;
  try {
    supplier = createLogtoManagementTokenSupplier({
      issuerOrigin: logtoOrigin,
      clientId: plainValue('TITAN_LOGTO_M2M_CLIENT_ID', env.TITAN_LOGTO_M2M_CLIENT_ID),
      clientSecret: plainValue('TITAN_LOGTO_M2M_CLIENT_SECRET', env.TITAN_LOGTO_M2M_CLIENT_SECRET),
      resource: plainValue('TITAN_LOGTO_MANAGEMENT_RESOURCE', env.TITAN_LOGTO_MANAGEMENT_RESOURCE),
      scope: plainValue('TITAN_LOGTO_MANAGEMENT_SCOPE', env.TITAN_LOGTO_MANAGEMENT_SCOPE),
      fetcher: timedFetch(fetcher ?? fetch, metrics),
    });
  } catch (e) {
    // The underlying validation messages name fields only; they never echo a value.
    throw new Error(`invalid Logto Management API configuration: ${e.message}`);
  }
  const verifier = new LogtoManagementVerifier({ origin: logtoOrigin, accessToken: supplier.accessToken, fetcher: timedFetch(fetcher ?? fetch, metrics) });
  const authoriseOperator = createLogtoOperatorAuthoriser({ verifier, operatorOrganisationId: operator.organisationId, administrativeRoleIds: operator.roleIds });
  // Provisioning is wired only when a database pool and link key sets are both supplied.
  const provision = pool && linkKeySets && linkKeySets.length > 0 ? createOperatorProvisioning({ pool, logto: verifier, linkKeySets }) : undefined;
  const readOrganisation = pool ? (organisationId) => readOrganisationAccess(pool, organisationId) : undefined;
  return createAdminHandler({ verifyToken, authoriseOperator, provision, readOrganisation, origins, productRegistry, logger, flagChange: flagChanges ? createFlagChangeHandler(flags) : undefined });
}
