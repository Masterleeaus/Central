#!/usr/bin/env python3
"""Structural checks for the reverse-proxy templates in deploy/proxy.

Read-only. Needs no nginx or Apache binary and makes no network calls. It catches template
mistakes that would drop the limits, expose the admin API, or let clients set forwarding headers.
It does NOT prove the proxy behaves correctly; that needs the runtime checks in README.md.
"""
import re
import shlex
import sys
from pathlib import Path

PROXY = Path(__file__).resolve().parent
NGINX_ZONES = PROXY / 'nginx' / 'zones.conf'
NGINX_LOCATIONS = PROXY / 'nginx' / 'locations.conf'
APACHE_VHOST = PROXY / 'apache' / 'titan-central-vhost.conf'

ACCESS_PROBES = ['/v1/access/check']
CALLBACK_PROBES = ['/auth/titan/field/callback', '/auth/titan/desk/callback', '/auth/titan/academy/callback', '/auth/titan/field/start', '/auth/titan/desk/start', '/auth/titan/academy/start', '/auth/central/start', '/auth/central/callback', '/auth/central/select']
ADMIN_PROBES = ['/v1/admin', '/v1/admin/', '/v1/admin/provision', '/v1/admin/oidc/plans']
# Served by the same Node process as the public routes, so the proxy is the only barrier (issue #74).
METRICS_PROBES = ['/metrics', '/metrics/', '/metrics/x']
INTERNAL_PROBES = ['/internal/', '/internal/x']
PRIVATE_PROBES = ADMIN_PROBES + METRICS_PROBES + INTERNAL_PROBES


def _kind(probe):
    return 'admin path' if probe.startswith('/v1/admin') else 'private path'


def strip_comments(text):
    """Drop full-line comments. The templates never use inline comments."""
    return '\n'.join('' if line.lstrip().startswith('#') else line for line in text.splitlines())


def nginx_match(modifier, pattern, path):
    if modifier == '=':
        return path == pattern
    if modifier == '^~':
        return path.startswith(pattern)
    if modifier == '~':
        return re.search(pattern, path) is not None
    if modifier == '~*':
        return re.search(pattern, path, re.IGNORECASE) is not None
    return path.startswith(pattern)  # plain prefix location


LOCATION = re.compile(r'location\s*(=|\^~|~\*|~)?\s*(\S+)\s*\{([^{}]*)\}')


def nginx_locations(text):
    return [(m.group(1) or '', m.group(2), m.group(3)) for m in LOCATION.finditer(strip_comments(text))]


def check_nginx(zones_text, locations_text):
    errors = []
    zones = strip_comments(zones_text)
    zone_defs = re.findall(r'limit_req_zone\s+(\S+)\s+zone=(\w+):\S+\s+rate=\S+;', zones)
    if not zone_defs:
        errors.append('nginx zones: no limit_req_zone defined')
    zone_names = set()
    for key, name in zone_defs:
        zone_names.add(name)
        if key != '$binary_remote_addr':
            errors.append(f'nginx zones: {name} keyed on {key}, not on the socket address $binary_remote_addr')

    locs = nginx_locations(locations_text)
    if not locs:
        errors.append('nginx locations: no location blocks parsed')
    covered = {probe: False for probe in ACCESS_PROBES + CALLBACK_PROBES}

    for modifier, pattern, body in locs:
        label = f'location {modifier} {pattern}'.replace('  ', ' ')
        if 'proxy_pass' in body:
            for probe in PRIVATE_PROBES:
                if nginx_match(modifier, pattern, probe):
                    errors.append(f'{label} proxies the {_kind(probe)} {probe}')
                    break
            if not re.search(r'proxy_set_header\s+X-Forwarded-For\s+\$remote_addr\s*;', body):
                errors.append(f'{label} does not overwrite X-Forwarded-For from $remote_addr')
            if re.search(r'\$http_(x_forwarded_for|forwarded)', body):
                errors.append(f'{label} passes a client-supplied forwarding header')
            if not re.search(r'proxy_set_header\s+Forwarded\s+""\s*;', body):
                errors.append(f'{label} does not clear the Forwarded header')
        for probe in covered:
            if nginx_match(modifier, pattern, probe):
                for zone in re.findall(r'limit_req\s+zone=(\w+)', body):
                    if zone in zone_names:
                        covered[probe] = True
    for probe, ok in covered.items():
        if not ok:
            errors.append(f'no limit_req on {probe}')

    if not any(nginx_match(m, p, '/v1/admin/provision') and re.search(r'return\s+404\s*;|deny\s+all\s*;', b)
               for m, p, b in locs):
        errors.append('nginx locations: no admin deny block (return 404 / deny all) for /v1/admin/')
    for probe in METRICS_PROBES + INTERNAL_PROBES:
        if not any(nginx_match(m, p, probe) and re.search(r'return\s+404\s*;|deny\s+all\s*;', b) for m, p, b in locs):
            errors.append(f'nginx locations: no deny block (return 404 / deny all) for {probe}')
    return errors


def apache_directives(text):
    out = []
    for line in strip_comments(text).splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(shlex.split(line))
        except ValueError:
            out.append(['__unparseable__', line])
    return out


def check_apache(text):
    errors = []
    d = apache_directives(text)

    qos = [t for t in d if t and t[0] == 'QS_LocRequestLimitMatch' and len(t) == 3]
    if not qos:
        errors.append('apache: no QS_LocRequestLimitMatch limit directive')
    for probe in ACCESS_PROBES + CALLBACK_PROBES:
        if not any(re.search(t[1], probe) for t in qos):
            errors.append(f'apache: no QS_LocRequestLimitMatch covers {probe}')

    if not any(t[:3] == ['RequestHeader', 'unset', 'X-Forwarded-For'] for t in d):
        errors.append('apache: X-Forwarded-For is not unset before proxying')
    for t in d:
        if t[:1] == ['RequestHeader'] and len(t) >= 3 and t[1] in ('append', 'add', 'merge') \
                and t[2].lower() in ('x-forwarded-for', 'forwarded', 'x-real-ip'):
            errors.append(f'apache: {t[1]} of {t[2]} keeps client-supplied forwarding headers')

    for t in d:
        if t[:1] == ['ProxyPass'] and len(t) >= 3:
            prefix = t[1]
            if prefix == '/':
                errors.append('apache: ProxyPass / proxies every path, including the admin API')
            for probe in PRIVATE_PROBES:
                if probe.startswith(prefix):
                    errors.append(f'apache: ProxyPass {prefix} proxies the {_kind(probe)} {probe}')
                    break
        if t[:1] == ['ProxyPassMatch'] and len(t) >= 3:
            for probe in PRIVATE_PROBES:
                if re.search(t[1], probe):
                    errors.append(f'apache: ProxyPassMatch {t[1]} proxies the {_kind(probe)} {probe}')
                    break
    if not any(t[:2] == ['RedirectMatch', '404'] and len(t) == 3 and re.search(t[2], '/v1/admin/provision') for t in d):
        errors.append('apache: no RedirectMatch 404 denial for /v1/admin/')
    for probe in METRICS_PROBES + INTERNAL_PROBES:
        if not any(t[:2] == ['RedirectMatch', '404'] and len(t) == 3 and re.search(t[2], probe) for t in d):
            errors.append(f'apache: no RedirectMatch 404 denial for {probe}')
    return errors


def main(argv):
    errors = check_nginx(NGINX_ZONES.read_text(), NGINX_LOCATIONS.read_text())
    errors += check_apache(APACHE_VHOST.read_text())
    for e in errors:
        print(e, file=sys.stderr)
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
