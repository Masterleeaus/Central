import type { ApplicationId } from './contracts.js';
export interface CatalogueEntry {
    /** Features granted per application. Every key must be a known application. */
    readonly products: Readonly<Partial<Record<ApplicationId, readonly string[]>>>;
}
export interface PlanCatalogueDefinition {
    readonly plans: Readonly<Record<string, CatalogueEntry>>;
    readonly addOns: Readonly<Record<string, CatalogueEntry>>;
}
export interface PlanCatalogue extends PlanCatalogueDefinition {
    readonly validated: true;
}
export declare class CatalogueError extends Error {
    readonly problems: readonly string[];
    constructor(problems: readonly string[]);
}
/** Features an application may grant: exactly the actions its registry declares (any role). */
export declare function knownFeatures(applicationId: ApplicationId): ReadonlySet<string>;
/** Validates a catalogue and returns a frozen copy. Throws CatalogueError listing every problem found. */
export declare function validateCatalogue(input: unknown): PlanCatalogue;
/** Grants for one subscription: the plan plus any add-ons, merged per application. Unknown ids throw. */
export declare function resolveGrants(catalogue: PlanCatalogue, planId: string, addOnIds: readonly string[]): ReadonlyMap<ApplicationId, readonly string[]>;
export declare const PLAN_CATALOGUE: PlanCatalogue;
