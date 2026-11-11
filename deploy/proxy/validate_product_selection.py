#!/usr/bin/env python3
"""Read-only security validation of product-host company selection proxy rules.

Does not assert the templates are deployed. Reverse proxy must be tested
on the actual product vhost before enabling tenant selection.
"""
from pathlib import Path
import re
import sys

HERE = Path(__file__).resolve().parent
NGINX = HERE / 'nginx' / 'product-selection.conf.template'
APACHE = HERE / 'apache' / 'product-selection.conf.template'
PRODUCT_PROBES = [
    '/auth/titan/field/select',
    '/auth/titan/desk/select',
    '/auth/titan/academy/select',
]
def validate(nginx, apache):
    failures = []
    pat = re.search(r'location\s+~\s+(\S+)\s*\{(.*?)\}', nginx, re.S)
    if pat is None or any(re.fullmatch(pat.group(1), url) is None for url in PRODUCT_PROBES):
        failures.append('nginx missing product select route')
    else:
        body = pat.group(2)
        checks = {
            'nginx request cap': r'limit_req\s+zone=titan_company_select\s+burst=\d+\s+nodelay;',
            'nginx concurrency cap': r'limit_conn\s+titan_conn\s+\d+;',
            'nginx body cap': r'client_max_body_size\s+4k;',
            'nginx forwarded header overwrite': r'proxy_set_header\s+X-Forwarded-For\s+\$remote_addr;',
            'nginx forwarded header removal': r'proxy_set_header\s+Forwarded\s+"";',
            'nginx product-only loopback target': r'proxy_pass\s+http://127\.0\.0\.1:__PRODUCT_PORT__;',
        }
        for name, expression in checks.items():
            if not re.search(expression, body):
                failures.append(name + ' missing or invalid')
        if '$http_x_forwarded_for' in body or '$http_forwarded' in body:
            failures.append('nginx untrusted forwarding header')
    for url in PRODUCT_PROBES:
        if not any(re.fullmatch(pattern, url) for pattern in re.findall(
            r'QS_LocRequestLimitMatch\s+"([^"]+)"\s+__SELECTION_CONCURRENT_LIMIT__', apache)):
            failures.append('apache missing product select concurrency ' + url)
        if not any(re.fullmatch(pattern, url) for pattern in re.findall(
            r'ProxyPassMatch\s+"([^"]+)"\s+"http://127\.0\.0\.1:__PRODUCT_PORT__/auth/titan/\$1/select"',apache)):
            failures.append('apache missing product select route ' + url)
    if re.search(r'(?m)^\s*ProxyPass\s+/\s+',apache):
        failures.append('apache wildcard root proxy forbidden')
    if 'RequestHeader unset X-Forwarded-For' not in apache:
        failures.append('apache client forwarding headers not removed')
    return failures

def main():
    errors = validate(NGINX.read_text(), APACHE.read_text())
    for error in errors:
        print(error, file=sys.stderr)
    return 1 if errors else 0

if __name__ == '__main__':
    raise SystemExit(main())
