import type { AccessDecision, AccessRequest, CentralRepository } from './contracts.js';
export interface TrustConfig {
    expectedIssuer: string;
    audienceByApplication: Readonly<Record<'field' | 'desk' | 'academy', string>>;
}
/** Does not authenticate callers. `principal` MUST come from token-verifying OIDC middleware. */
export declare class CentralAccessService {
    private readonly repository;
    private readonly trust;
    constructor(repository: CentralRepository, trust: TrustConfig);
    authorise(request: AccessRequest): Promise<AccessDecision>;
}
