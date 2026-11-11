#!/usr/bin/env python3
"""Read-only live check of the public Central proxy (issue #74). Run it from OUTSIDE the host, after the
templates in deploy/proxy are applied. It sends only unauthenticated GET requests, sends no cookies or
credentials, never follows redirects, and never prints response bodies.

Usage:
  python3 -I deploy/proxy/live_check.py --host <central public hostname> \
      [--port <TITAN_CENTRAL_PORT> --public-ip <host public IPv4 or IPv6>]

Expected results (every check must pass; exit 0 only when all pass):
  /v1/admin/provision, /v1/admin/      -> 404   operator API is not published
  /metrics, /metrics/x                  -> 404   metrics are not published
  /internal/                            -> 404   internal surfaces are not published
  /v1/access/check                      -> 401   reachable, no token supplied (not 404)
  node port on the public IP            -> unreachable (refused or timeout); only with --port and --public-ip

A failed TLS handshake is reported as unreachable, so check the certificate separately if that appears.
"""
import argparse
import sys
import urllib.error
import urllib.request

UNREACHABLE = 'unreachable'
TIMEOUT_SECONDS = 10


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """A redirect is reported as its own status, so a 301 or 302 never passes a 404 or 401 check."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def build_checks(host, port=None, public_ip=None):
    """Returns (name, url, expected statuses) tuples. Only the hostname is used for the public checks."""
    base = f'https://{host}'
    checks = [
        ('operator API denied (provision)', f'{base}/v1/admin/provision', {404}),
        ('operator API denied (root)', f'{base}/v1/admin/', {404}),
        ('metrics denied', f'{base}/metrics', {404}),
        ('metrics sub-path denied', f'{base}/metrics/x', {404}),
        ('internal surfaces denied', f'{base}/internal/', {404}),
        ('access check reachable without a token', f'{base}/v1/access/check', {401}),
    ]
    if port is not None and public_ip is not None:
        host_part = f'[{public_ip}]' if ':' in public_ip else public_ip
        checks.append(('node port not reachable from outside', f'http://{host_part}:{port}/healthz', {UNREACHABLE}))
    return checks


def fetch_status(url, timeout=TIMEOUT_SECONDS):
    """GET with no headers beyond the defaults. Returns the HTTP status, or UNREACHABLE on any transport error."""
    opener = urllib.request.build_opener(_NoRedirect)
    try:
        with opener.open(url, timeout=timeout) as response:
            return response.status
    except urllib.error.HTTPError as e:
        return e.code
    except (urllib.error.URLError, OSError, ValueError):
        return UNREACHABLE


def run_checks(checks, fetch=fetch_status):
    results = []
    for name, url, expected in checks:
        actual = fetch(url)
        results.append({'name': name, 'url': url, 'expected': sorted(expected, key=str), 'actual': actual,
                        'ok': actual in expected})
    return results


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--host', required=True, help='public hostname served by the proxy (https)')
    p.add_argument('--port', type=int, help='TITAN_CENTRAL_PORT, for the direct-port check')
    p.add_argument('--public-ip', help='public address of the host, for the direct-port check')
    a = p.parse_args(argv)
    if (a.port is None) != (a.public_ip is None):
        p.error('--port and --public-ip must be given together')
    if '/' in a.host or ':' in a.host or not a.host:
        p.error('--host must be a bare hostname')
    results = run_checks(build_checks(a.host, a.port, a.public_ip))
    for r in results:
        verdict = 'PASS' if r['ok'] else 'FAIL'
        print(f"{verdict}  {r['name']}  expected={'/'.join(map(str, r['expected']))} actual={r['actual']}  {r['url']}")
    failed = [r for r in results if not r['ok']]
    print(f"{len(results) - len(failed)}/{len(results)} checks passed")
    return 0 if not failed else 1


if __name__ == '__main__':
    sys.exit(main())
