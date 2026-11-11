import { type FlagStore } from './feature-flags.js';
import type { SqlPool } from './postgres.js';
/** Creates the FlagStore for a pg-compatible pool. The pool is injected; this module does not import pg. */
export declare function createPostgresFlagStore(pool: SqlPool): FlagStore;
