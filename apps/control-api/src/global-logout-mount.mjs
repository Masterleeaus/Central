/** Mounts the global (RP-initiated) logout routes for issue #6. Off unless TITAN_GLOBAL_LOGOUT_ENABLED=1.
 * When on, it builds POST /auth/titan/global-logout and the registered post-logout landing route.
 * Both are built from config and injected dependencies only. Nothing here reads a session from the request.
 *
 * The caller must inject authenticateSession (an app-owned session lookup that returns the sealed ID token
 * and the caller's own scopes). This repository has no such loader yet, so server.mjs passes none. With the
 * gate on and no loader, startup fails on purpose instead of mounting a route that cannot sign anyone out. */
import {createGlobalLogout,createGlobalLogoutHandler,createLogoutLandingHandler} from './oidc-global-logout.mjs';
import {createPostgresSessionRevocations} from './session-revocation-pg.mjs';

export const GLOBAL_LOGOUT_ENABLED_ENV = 'TITAN_GLOBAL_LOGOUT_ENABLED';
export const GLOBAL_LOGOUT_POST_URI_ENV = 'TITAN_GLOBAL_LOGOUT_POST_URI';

/** Reads the feature gate. Unset, empty or '0' is off. '1' is on. Anything else is a configuration error. */
export function readGlobalLogoutGate(env = {}) {
  const value = env[GLOBAL_LOGOUT_ENABLED_ENV];
  if (value === undefined || value === '' || value === '0') return false;
  if (value === '1') return true;
  throw new TypeError('invalid global logout feature flag');
}

/**
 * Returns {logoutHandler, landingHandler} when the gate is on, or null when it is off.
 * Each handler has the (req, res) => Promise<boolean> shape that createCentralHandler expects.
 * Allowed application origins come from the product registry settings (TITAN_FIELD_ORIGIN, TITAN_DESK_ORIGIN,
 * TITAN_ACADEMY_ORIGIN). Any missing or malformed origin makes createGlobalLogoutHandler throw.
 */
export function createGlobalLogoutMount({env = {}, pool, authenticateSession, logger = () => {}} = {}) {
  if (!readGlobalLogoutGate(env)) return null;
  if (typeof authenticateSession !== 'function') throw new TypeError('global logout session authenticator required');
  const postLogoutRedirectUri = env[GLOBAL_LOGOUT_POST_URI_ENV];
  const globalLogout = createGlobalLogout({
    issuer: env.TITAN_OIDC_ISSUER,
    postLogoutRedirectUris: [postLogoutRedirectUri],
    revocations: createPostgresSessionRevocations({ pool }),
  });
  const logoutHandler = createGlobalLogoutHandler({
    globalLogout,
    authenticateSession,
    postLogoutRedirectUri,
    allowedOrigins: [env.TITAN_FIELD_ORIGIN, env.TITAN_DESK_ORIGIN, env.TITAN_ACADEMY_ORIGIN],
    logger,
  });
  const landingHandler = createLogoutLandingHandler({ postLogoutRedirectUri, logger });
  return Object.freeze({ logoutHandler, landingHandler });
}
