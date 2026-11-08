/** Operator (admin) plane configuration. Read from the environment at startup only.
 * Off unless TITAN_OPERATOR_ORGANISATION_ID and TITAN_OPERATOR_ROLE_IDS are both set. Once either is set,
 * every operator setting must be valid or startup throws. Error messages name variables, never values. */
import { createLogtoManagementTokenSupplier, LogtoManagementVerifier, createTitanOidcRegistrationPlans } from '../../../packages/control-plane/dist/index.js';
import { createAdminHandler, createLogtoOperatorAuthoriser } from './admin.mjs';
import { timedFetch } from './metrics.mjs';

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

/** Builds the /v1/admin/ handler when the operator plane is on, otherwise returns null (route stays 404).
 * fetcher and metrics are injectable for tests. Logto calls are counted and timed through timedFetch. */
export function createOperatorAdmin({ env, verifyToken, metrics, logger = () => {}, fetcher }) {
  const operator = readOperatorConfig(env);
  if (!operator) return null;
  const origins = {
    desk: httpsOrigin('TITAN_DESK_ORIGIN', env.TITAN_DESK_ORIGIN),
    field: httpsOrigin('TITAN_FIELD_ORIGIN', env.TITAN_FIELD_ORIGIN),
    academy: httpsOrigin('TITAN_ACADEMY_ORIGIN', env.TITAN_ACADEMY_ORIGIN),
  };
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
  // provision is intentionally not wired here: POST /v1/admin/provision answers 503 provisioning_disabled.
  return createAdminHandler({ verifyToken, authoriseOperator, origins, logger });
}
