export declare const WEBHOOK_TOLERANCE_SECONDS = 300;
export type WebhookRejectCode = 'missing_signature' | 'malformed_signature' | 'bad_signature' | 'stale_timestamp' | 'future_timestamp';
export type WebhookVerification = {
    ok: true;
    timestamp: number;
} | {
    ok: false;
    code: WebhookRejectCode;
};
/** Computes the header value for a body. Used by tests and fake providers; real providers sign on their side. */
export declare function signWebhookPayload(rawBody: string, timestamp: number, secret: string): string;
/** Checks the signature first and only then the timestamp, so an attacker cannot use the timestamp
 * check as an oracle on unsigned content. Comparison is constant time. */
export declare function verifyWebhookSignature(input: {
    rawBody: string;
    signatureHeader: string | undefined;
    secret: string;
    now: Date;
    toleranceSeconds?: number;
}): WebhookVerification;
