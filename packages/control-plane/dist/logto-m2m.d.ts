/** Fixed-origin Logto Management API OAuth2 client-credentials token supplier.
 * This is strictly server-side; credentials must never be accepted from requests.
 */
export interface LogtoMachineOptions {
    issuerOrigin: string;
    clientId: string;
    clientSecret: string;
    resource: string;
    scope: string;
    fetcher?: typeof fetch;
    clock?: () => number;
    refreshSkewMs?: number;
}
export declare class LogtoMachineError extends Error {
    constructor(message?: string);
}
export declare class LogtoMachineTokenClient {
    readonly origin: string;
    private readonly opts;
    private readonly fetcher;
    private readonly clock;
    private readonly skew;
    private cached?;
    private pending?;
    constructor(opts: LogtoMachineOptions);
    accessToken(): Promise<string>;
    invalidate(): void;
    private acquire;
}
/** Wire the callback to LogtoManagementVerifier without exposing secrets. */
export declare const createLogtoManagementTokenSupplier: (opts: LogtoMachineOptions) => {
    origin: string;
    accessToken: () => Promise<string>;
    invalidate: () => void;
};
