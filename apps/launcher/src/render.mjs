/** Escapes text for HTML text and quoted attribute contexts. */
export const esc = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

export function page({ title, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/assets/launcher.css">
</head>
<body>
<a class="skip-link" href="#main">Skip to main content</a>
<header class="site-header"><p class="brand">Titan Central</p></header>
<main id="main" tabindex="-1">
${body}
</main>
</body>
</html>
`;
}

export function signedOutBody({ signInHref, message }) {
  const status = message ? `<p role="status">${esc(message)}</p>` : '';
  const action = signInHref
    ? `<p><a class="button" href="${esc(signInHref)}">Sign in</a></p>`
    : '<p>Sign-in is not configured for this launcher yet.</p>';
  return `<h1>Sign in to Titan Central</h1>
${status}
${action}`;
}

const STATUS_TEXT = {
  available: 'Access granted.',
  denied: 'Access denied for this company.',
  unavailable: 'Status unavailable. Try again later.',
};

/**
 * Renders what the server decided. A product link appears only for state 'available'; hiding a link
 * here is presentation only, the server-side access check is the enforcement point.
 */
export function launcherBody({ companyName, switchUrl, products }) {
  const switchBlock = switchUrl
    ? `<p><a href="${esc(switchUrl)}">Switch company</a></p>`
    : '<p>Company switching is not available yet.</p>';
  const items = products.map(({ product, state }) => {
    const link = state === 'available' && product.url
      ? `<p><a class="button" href="${esc(product.url)}">Open ${esc(product.displayName)}</a></p>`
      : '';
    return `<li class="product product--${state}">
<h3>${esc(product.displayName)}</h3>
<p class="status">${esc(STATUS_TEXT[state] ?? STATUS_TEXT.unavailable)}</p>
${link}
</li>`;
  }).join('\n');
  return `<h1>Your products</h1>
<section aria-labelledby="company-heading">
<h2 id="company-heading">Active company</h2>
<p>${esc(companyName)}</p>
${switchBlock}
</section>
<section aria-labelledby="products-heading">
<h2 id="products-heading">Products</h2>
<ul class="product-list">
${items}
</ul>
</section>`;
}

export function notFoundBody() {
  return '<h1>Page not found</h1>\n<p><a href="/">Return to the launcher</a></p>';
}
