/**
 * Titan Central launcher HTML route, deliberately separate from product session
 * creation. The hosting application MUST inject a verified server-side session
 * resolver and a company-scoped entitlement reader. Never pass client claims
 * directly into either callback.
 */
const PRODUCTS = Object.freeze(['sorted', 'supercharged', 'lms']);
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const verifiedSubject = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\s\x00-\x1f\x7f]/u.test(value);
const noStore = Object.freeze({'cache-control':'no-store, private','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'DENY','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"});
const response = (res,status,body,type='text/plain; charset=utf-8',logoutEnabled=false) => {
  res.writeHead(status,{...noStore,'content-type':type,...(logoutEnabled?{'content-security-policy':noStore['content-security-policy'].replace("form-action 'none'","form-action 'self'")}:{})});
  res.end(body);
};
function destination(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search || url.pathname !== '/' || url.port) return null;
    return url.href;
  } catch { return null; }
}
export function validateLauncherDestinations(config) {
  if (!config || typeof config !== 'object' || Object.keys(config).some(key => !PRODUCTS.includes(key))) throw new TypeError('invalid launcher destinations');
  const entries = Object.entries(config).map(([key, value]) => [key, destination(value)]);
  if (entries.some(([,value]) => value === null)) throw new TypeError('launcher destinations must be HTTPS origins');
  if (new Set(entries.map(([,value]) => value)).size !== entries.length) throw new TypeError('launcher destinations must be distinct');
  return Object.freeze(Object.fromEntries(entries));
}
export function renderCentralLauncher({company,products,destinations,logoutEnabled=false}) {
  if (!company || !uuid(company.id) || typeof company.name !== 'string' || !company.name.trim() || company.name.length > 160) throw new TypeError('invalid company');
  if (!Array.isArray(products) || products.length !== PRODUCTS.length) throw new TypeError('invalid product decisions');
  const seen = new Set();
  const cards = products.map(product => {
    if (!product || !PRODUCTS.includes(product.id) || seen.has(product.id) || !['allowed','denied','unavailable'].includes(product.status)) throw new TypeError('invalid product decision');
    seen.add(product.id);
    const name = {sorted:'Sorted',supercharged:'Supercharged',lms:'LMS'}[product.id];
    const href = destinations[product.id];
    const active = product.status === 'allowed' && typeof href === 'string';
    const status = active ? 'Available' : product.status === 'denied' ? 'Not included' : 'Unavailable';
    return `<article class="product"><div><h2>${name}</h2><p>${status}</p></div>${active ? `<a href="${escapeHtml(href)}" rel="noopener noreferrer">Open ${name}</a>` : '<span aria-disabled="true">Access unavailable</span>'}</article>`;
  });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Titan Central · Products</title><style>:root{color-scheme:dark;font:16px system-ui,sans-serif;background:#17212b;color:#f0f5f9}body{margin:0}main{max-width:900px;margin:0 auto;padding:clamp(20px,5vw,64px)}header{border-bottom:1px solid #536371;padding-bottom:24px;margin-bottom:30px}.eyebrow{color:#88b4db;font-size:.85rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase}h1{font-size:clamp(2rem,5vw,3rem);margin:8px 0}h2{margin:0;font-size:1.2rem}p{color:#bed0df}.products{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr))}.product{background:#243341;border:1px solid #465b6b;padding:24px;border-radius:14px;display:flex;min-height:150px;flex-direction:column;justify-content:space-between}a{background:#234d78;color:white;display:inline-block;padding:11px 15px;border-radius:8px;font-weight:600;text-decoration:none}a:focus-visible{outline:3px solid #78cfa0;outline-offset:3px}span[aria-disabled]{color:#aab7c3}button{background:#234d78;color:white;border:0;border-radius:8px;padding:11px 15px;margin-top:20px;cursor:pointer}button:focus-visible{outline:3px solid #78cfa0;outline-offset:3px}footer{padding-top:30px;color:#aab7c3}</style></head><body><main><header><div class="eyebrow">Titan Central</div><h1>Products</h1><p>Company: <strong>${escapeHtml(company.name)}</strong></p></header><section class="products" aria-label="Products">${cards.join('')}</section>${logoutEnabled ? '<form method="post" action="/auth/central/logout"><button type="submit">Sign out of Central</button></form>' : ''}<footer>Product access is checked by each destination server. Switching companies requires a new verified organisation selection.</footer></main></body></html>`;
}
/**
 * resolveSession(req) must authenticate the opaque host-only session cookie
 * against trusted server-side state. readProducts({identityId,companyId}) MUST
 * independently verify current membership and all product entitlements.
 */
export function createCentralLauncherHandler({resolveSession,readProducts,destinations,logoutEnabled=false}) {
  if (typeof resolveSession !== 'function' || typeof readProducts !== 'function') throw new TypeError('trusted launcher dependencies required');
  const links = validateLauncherDestinations(destinations);
  return async function centralLauncher(req,res) {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path !== '/central') return false;
    if (req.method !== 'GET') { response(res,405,'Method not allowed'); return true; }
    try {
      const session = await resolveSession(req);
      if (!session || !verifiedSubject(session.identityId) || !uuid(session.companyId)) { response(res,401,'Sign in required'); return true; }
      const data = await readProducts({identityId:session.identityId,companyId:session.companyId});
      if (!data || !data.authorised || data.company?.id !== session.companyId) { response(res,403,'Company access denied'); return true; }
      const html = renderCentralLauncher({company:data.company,products:data.products,destinations:links,logoutEnabled});
      response(res,200,html,'text/html; charset=utf-8',logoutEnabled);
    } catch {
      response(res,503,'Launcher unavailable');
    }
    return true;
  };
}
