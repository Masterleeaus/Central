/** Read-only OIDC registration verifier. No client secrets or administrative mutations.
 * Source: Logto v1.45.0 packages/core/src/routes/applications/application.ts GET /applications.
 */
import type { OidcApplicationPlan } from './oidc-registration.js';
type FetchLike = typeof fetch;
export interface LogtoApplicationsOptions {
    origin: string;
    accessToken: () => Promise<string>;
    fetcher?: FetchLike;
    maxPages?: number;
}
export interface RegistrationStatus {
    app: string;
    state: 'registered' | 'missing' | 'mismatch' | 'ambiguous';
    applicationId?: string;
    issues: readonly string[];
}
export declare class LogtoApplicationInspector {
    private readonly origin;
    private readonly fetcher;
    private readonly token;
    private readonly pages;
    constructor(opts: LogtoApplicationsOptions);
    inspect(plans: readonly OidcApplicationPlan[], assignedIds: Partial<Record<'supercharged' | 'sorted' | 'lms', string>>): Promise<readonly RegistrationStatus[]>;
}
export {};
