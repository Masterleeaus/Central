import sys
import unittest
from pathlib import Path

DEPLOY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DEPLOY / 'proxy'))
from validate_templates import (APACHE_VHOST, NGINX_LOCATIONS, NGINX_ZONES, check_apache, check_nginx)

ZONES = NGINX_ZONES.read_text()
LOCS = NGINX_LOCATIONS.read_text()
VHOST = APACHE_VHOST.read_text()


class RealTemplates(unittest.TestCase):
    def test_nginx_templates_pass(self):
        self.assertEqual(check_nginx(ZONES, LOCS), [])

    def test_apache_template_passes(self):
        self.assertEqual(check_apache(VHOST), [])

    def test_no_placeholder_hostnames_or_real_secrets(self):
        for text in (ZONES, LOCS, VHOST):
            self.assertNotIn('.example', text.lower().replace('example.com', ''))
            self.assertNotRegex(text, r'(?i)(secret|password|token|bearer)\s*[=:]')


class NginxRejections(unittest.TestCase):
    def test_no_limit_directive_is_rejected(self):
        locs = LOCS.replace('limit_req zone=titan_access burst=40 nodelay;', '')
        errs = check_nginx(ZONES, locs)
        self.assertTrue(any('no limit_req on /v1/access/check' in e for e in errs), errs)

    def test_no_zone_definitions_is_rejected(self):
        errs = check_nginx('', LOCS)
        self.assertTrue(any('no limit_req_zone' in e for e in errs), errs)

    def test_wildcard_that_opens_admin_is_rejected(self):
        locs = LOCS.replace('location ^~ /v1/admin/ {', 'location ~ ^/v1/.* {\n    proxy_pass http://127.0.0.1:3102;\n}\nlocation ^~ /v1/admin/ {')
        errs = check_nginx(ZONES, locs)
        self.assertTrue(any('proxies the admin path' in e for e in errs), errs)

    def test_root_proxy_is_rejected(self):
        locs = LOCS + '\nlocation / {\n    proxy_set_header X-Forwarded-For $remote_addr;\n    proxy_set_header Forwarded "";\n    proxy_pass http://127.0.0.1:3102;\n}\n'
        errs = check_nginx(ZONES, locs)
        self.assertTrue(any('location / proxies the admin path' in e for e in errs), errs)

    def test_client_forwarding_header_passthrough_is_rejected(self):
        locs = LOCS.replace('proxy_set_header X-Forwarded-For $remote_addr;', 'proxy_set_header X-Forwarded-For $http_x_forwarded_for;', 1)
        errs = check_nginx(ZONES, locs)
        self.assertTrue(any('client-supplied forwarding header' in e or 'does not overwrite' in e for e in errs), errs)

    def test_missing_admin_deny_is_rejected(self):
        locs = LOCS.replace('location ^~ /v1/admin/ {\n    return 404;\n}', '')
        errs = check_nginx(ZONES, locs)
        self.assertTrue(any('no admin deny' in e for e in errs), errs)

    def test_zone_keyed_on_client_header_is_rejected(self):
        zones = ZONES.replace('$binary_remote_addr zone=titan_access', '$http_x_forwarded_for zone=titan_access')
        errs = check_nginx(zones, LOCS)
        self.assertTrue(any('not on the socket address' in e for e in errs), errs)


class ApacheRejections(unittest.TestCase):
    def test_no_limit_directive_is_rejected(self):
        text = '\n'.join(l for l in VHOST.splitlines() if not l.startswith('QS_LocRequestLimitMatch'))
        errs = check_apache(text)
        self.assertTrue(any('no QS_LocRequestLimitMatch limit directive' in e for e in errs), errs)

    def test_wildcard_that_opens_admin_is_rejected(self):
        text = VHOST.replace('ProxyPassMatch "^/v1/access/check$"', 'ProxyPassMatch "^/v1/.*"')
        errs = check_apache(text)
        self.assertTrue(any('proxies the admin path' in e for e in errs), errs)

    def test_proxy_pass_root_is_rejected(self):
        errs = check_apache(VHOST + '\nProxyPass / "http://127.0.0.1:3102/"\n')
        self.assertTrue(any('ProxyPass / proxies every path' in e for e in errs), errs)

    def test_forwarding_header_append_is_rejected(self):
        errs = check_apache(VHOST + '\nRequestHeader append X-Forwarded-For "1.2.3.4"\n')
        self.assertTrue(any('keeps client-supplied forwarding headers' in e for e in errs), errs)

    def test_missing_xff_unset_is_rejected(self):
        text = '\n'.join(l for l in VHOST.splitlines() if 'RequestHeader unset X-Forwarded-For' not in l)
        errs = check_apache(text)
        self.assertTrue(any('not unset before proxying' in e for e in errs), errs)

    def test_missing_admin_redirect_is_rejected(self):
        text = '\n'.join(l for l in VHOST.splitlines() if not l.startswith('RedirectMatch'))
        errs = check_apache(text)
        self.assertTrue(any('no RedirectMatch 404' in e for e in errs), errs)


if __name__ == '__main__':
    unittest.main()
