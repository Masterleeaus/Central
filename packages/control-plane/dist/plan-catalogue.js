/** Declared plan and add-on catalogue (issue #35). Data lives in code and is validated when this module loads.
 * A plan or add-on may grant features only in applications that exist in the application registry, and
 * only the features that registry declares for that application. Nothing else can reach an entitlement.
 *
 * TO DECIDE: the real plan ids, add-on ids, products and feature sets are commercial decisions. The
 * entries below are placeholders named `example_*` so the mapping can be exercised; they must be replaced
 * by the product owner before any real provider is connected. Provider price ids must map to these ids
 * in the adapter, never the other way round.
 */
import { allApplications } from './applications.js';
export class CatalogueError extends Error {
    problems;
    constructor(problems) {
        super(`plan catalogue invalid: ${problems.join('; ')}`);
        this.problems = problems;
        this.name = 'CatalogueError';
    }
}
const ID_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
/** Features an application may grant: exactly the actions its registry declares (any role). */
export function knownFeatures(applicationId) {
    const app = allApplications().find(a => a.id === applicationId);
    if (!app)
        return new Set();
    return new Set(Object.values(app.defaultActions).flatMap(actions => [...actions]));
}
const KNOWN_APPLICATIONS = new Set(allApplications().map(a => a.id));
/** Validates a catalogue and returns a frozen copy. Throws CatalogueError listing every problem found. */
export function validateCatalogue(input) {
    const problems = [];
    const root = input;
    if (!root || typeof root !== 'object' || typeof root.plans !== 'object' || root.plans === null || typeof root.addOns !== 'object' || root.addOns === null) {
        throw new CatalogueError(['catalogue must declare plans and addOns objects']);
    }
    const seen = new Set();
    const check = (kind, table) => {
        const out = {};
        for (const [id, raw] of Object.entries(table)) {
            const label = `${kind} "${id}"`;
            if (!ID_PATTERN.test(id))
                problems.push(`${label}: id must match ${ID_PATTERN.source}`);
            if (seen.has(id))
                problems.push(`${label}: id is declared more than once (plans and add-ons share one id space)`);
            seen.add(id);
            const products = raw?.products;
            if (!products || typeof products !== 'object' || Array.isArray(products)) {
                problems.push(`${label}: products must be an object`);
                continue;
            }
            const entries = Object.entries(products);
            if (entries.length === 0)
                problems.push(`${label}: must grant at least one product`);
            const copy = {};
            for (const [app, features] of entries) {
                if (!KNOWN_APPLICATIONS.has(app)) {
                    problems.push(`${label}: unknown product "${app}"`);
                    continue;
                }
                if (!Array.isArray(features) || features.length === 0) {
                    problems.push(`${label}: product "${app}" must list features`);
                    continue;
                }
                const allowed = knownFeatures(app);
                const unique = new Set();
                for (const f of features) {
                    if (typeof f !== 'string' || !allowed.has(f))
                        problems.push(`${label}: feature ${JSON.stringify(f)} is not declared for product "${app}"`);
                    else if (unique.has(f))
                        problems.push(`${label}: feature "${f}" repeated for "${app}"`);
                    else
                        unique.add(f);
                }
                copy[app] = Object.freeze([...unique].sort());
            }
            out[id] = Object.freeze({ products: Object.freeze(copy) });
        }
        return out;
    };
    const plans = check('plan', root.plans);
    const addOns = check('addOn', root.addOns);
    if (Object.keys(plans).length === 0)
        problems.push('catalogue declares no plans');
    if (problems.length)
        throw new CatalogueError(problems);
    return Object.freeze({ plans: Object.freeze(plans), addOns: Object.freeze(addOns), validated: true });
}
/** Grants for one subscription: the plan plus any add-ons, merged per application. Unknown ids throw. */
export function resolveGrants(catalogue, planId, addOnIds) {
    const plan = Object.prototype.hasOwnProperty.call(catalogue.plans, planId) ? catalogue.plans[planId] : undefined;
    if (!plan)
        throw new CatalogueError([`unknown plan "${planId}"`]);
    const sources = [plan];
    const seenAddOns = new Set();
    for (const id of addOnIds) {
        if (seenAddOns.has(id))
            throw new CatalogueError([`add-on "${id}" listed more than once`]);
        seenAddOns.add(id);
        const addOn = Object.prototype.hasOwnProperty.call(catalogue.addOns, id) ? catalogue.addOns[id] : undefined;
        if (!addOn)
            throw new CatalogueError([`unknown add-on "${id}"`]);
        sources.push(addOn);
    }
    const merged = new Map();
    for (const source of sources) {
        for (const [app, features] of Object.entries(source.products)) {
            const set = merged.get(app) ?? new Set();
            features.forEach(f => set.add(f));
            merged.set(app, set);
        }
    }
    return new Map([...merged].map(([app, set]) => [app, Object.freeze([...set].sort())]));
}
/** Declared catalogue (placeholders, see the TO DECIDE note above). Validated at module load. */
const DECLARED = {
    plans: {
        example_field_basic: { products: { field: ['session:open', 'clients:read', 'jobs:read', 'visits:read'] } },
        example_field_plus: { products: { field: ['session:open', 'clients:read', 'jobs:read', 'visits:read', 'team:read'] } },
        example_academy_basic: { products: { academy: ['session:open', 'courses:read', 'certificates:read'] } },
    },
    addOns: {
        example_desk_addon: { products: { desk: ['session:open', 'communications:read'] } },
    },
};
export const PLAN_CATALOGUE = validateCatalogue(DECLARED);
