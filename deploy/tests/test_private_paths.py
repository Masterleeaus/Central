import contextlib
import io
import sys
import unittest
from pathlib import Path

DEPLOY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DEPLOY / 'proxy'))
from validate_templates import (APACHE_VHOST, NGINX_LOCATIONS, NGINX_ZONES, check_apache, check_nginx)
import live_check

ZONES = NGINX_ZONES.read_text()
LOCS = NGINX_LOCATIONS.read_text()
VHOST = APACHE_VHOST.read_text()

METRICS_DENY = 'location ^~ /metrics {\n    return 404;\n}\n'
INTERNAL_DENY = 'location ^~ /internal/ {\n    return 404;\n}\n'


class PrivatePathTemplates(unittest.TestCase):
    def test_real_nginx_template_denies_metrics_and_internal(self):
        self.assertIn(METRICS_DENY, LOCS)
        self.assertIn(INTERNAL_DENY, LOCS)
        self.assertEqual(check_nginx(ZONES, LOCS), [])

    def test_real_apache_template_denies_metrics_and_internal(self):
        self.assertIn('RedirectMatch 404 ^/metrics', VHOST)
        self.assertIn('RedirectMatch 404 ^/internal/', VHOST)
        self.assertEqual(check_apache(VHOST), [])


class NginxPrivatePaths(unittest.TestCase):
    def test_missing_metrics_deny_is_rejected(self):
        errs = check_nginx(ZONES, LOCS.replace(METRICS_DENY, ''))
        self.assertTrue(any('no deny block (return 404 / deny all) for /metrics' in e for e in errs), errs)

    def test_missing_internal_deny_is_rejected(self):
        errs = check_nginx(ZONES, LOCS.replace(INTERNAL_DENY, ''))
        self.assertTrue(any('for /internal/' in e for e in errs), errs)

    def test_proxying_metrics_is_rejected(self):
        proxy = ('location = /metrics {\n    proxy_set_header X-Forwarded-For $remote_addr;\n'
                 '    proxy_set_header Forwarded "";\n    proxy_pass http://127.0.0.1:3102;\n}\n')
        errs = check_nginx(ZONES, LOCS + '\n' + proxy)
        self.assertTrue(any('proxies the private path /metrics' in e for e in errs), errs)

    def test_proxying_internal_prefix_is_rejected(self):
        proxy = ('location ^~ /internal/ {\n    proxy_set_header X-Forwarded-For $remote_addr;\n'
                 '    proxy_set_header Forwarded "";\n    proxy_pass http://127.0.0.1:3102;\n}\n')
        errs = check_nginx(ZONES, LOCS.replace(INTERNAL_DENY, '') + '\n' + proxy)
        self.assertTrue(any('proxies the private path /internal/' in e for e in errs), errs)


class ApachePrivatePaths(unittest.TestCase):
    def test_missing_metrics_redirect_is_rejected(self):
        text = '\n'.join(l for l in VHOST.splitlines() if l.strip() != 'RedirectMatch 404 ^/metrics')
        errs = check_apache(text)
        self.assertTrue(any('no RedirectMatch 404 denial for /metrics' in e for e in errs), errs)

    def test_missing_internal_redirect_is_rejected(self):
        text = '\n'.join(l for l in VHOST.splitlines() if l.strip() != 'RedirectMatch 404 ^/internal/')
        errs = check_apache(text)
        self.assertTrue(any('no RedirectMatch 404 denial for /internal/' in e for e in errs), errs)

    def test_proxy_pass_match_metrics_is_rejected(self):
        errs = check_apache(VHOST + '\nProxyPassMatch "^/metrics" "http://127.0.0.1:3102/metrics"\n')
        self.assertTrue(any('ProxyPassMatch ^/metrics proxies the private path /metrics' in e for e in errs), errs)

    def test_proxy_pass_internal_prefix_is_rejected(self):
        errs = check_apache(VHOST + '\nProxyPass /internal/ "http://127.0.0.1:3102/internal/"\n')
        self.assertTrue(any('ProxyPass /internal/ proxies the private path /internal/' in e for e in errs), errs)


class LiveCheck(unittest.TestCase):
    def expected_statuses(self):
        return {
            'https://central.test/v1/admin/provision': 404,
            'https://central.test/v1/admin/': 404,
            'https://central.test/metrics': 404,
            'https://central.test/metrics/x': 404,
            'https://central.test/internal/': 404,
            'https://central.test/v1/access/check': 401,
        }

    def test_checks_cover_each_required_path_once(self):
        urls = [u for _, u, _ in live_check.build_checks('central.test')]
        self.assertEqual(len(urls), len(set(urls)))
        for path in ('/v1/admin/provision', '/v1/admin/', '/metrics', '/metrics/x', '/internal/', '/v1/access/check'):
            self.assertIn('https://central.test' + path, urls)

    def test_passes_when_every_status_is_as_expected(self):
        table = self.expected_statuses()
        results = live_check.run_checks(live_check.build_checks('central.test'), fetch=lambda u: table[u])
        self.assertTrue(all(r['ok'] for r in results))

    def test_fails_when_metrics_is_published(self):
        table = self.expected_statuses()
        table['https://central.test/metrics'] = 200
        results = live_check.run_checks(live_check.build_checks('central.test'), fetch=lambda u: table[u])
        failed = [r['url'] for r in results if not r['ok']]
        self.assertEqual(failed, ['https://central.test/metrics'])

    def test_redirect_is_not_a_pass(self):
        table = self.expected_statuses()
        table['https://central.test/v1/admin/'] = 302
        results = live_check.run_checks(live_check.build_checks('central.test'), fetch=lambda u: table[u])
        self.assertFalse(next(r for r in results if r['url'].endswith('/v1/admin/'))['ok'])

    def test_direct_port_check_expects_unreachable(self):
        checks = live_check.build_checks('central.test', port=3102, public_ip='203.0.113.10')
        self.assertEqual(checks[-1][1], 'http://203.0.113.10:3102/healthz')
        ok = live_check.run_checks(checks[-1:], fetch=lambda u: 'unreachable')
        self.assertTrue(ok[0]['ok'])
        bad = live_check.run_checks(checks[-1:], fetch=lambda u: 200)
        self.assertFalse(bad[0]['ok'])

    def test_main_rejects_port_without_ip(self):
        with self.assertRaises(SystemExit) as ctx, contextlib.redirect_stderr(io.StringIO()):
            live_check.main(['--host', 'central.test', '--port', '3102'])
        self.assertEqual(ctx.exception.code, 2)

    def test_main_rejects_host_with_scheme(self):
        with self.assertRaises(SystemExit) as ctx, contextlib.redirect_stderr(io.StringIO()):
            live_check.main(['--host', 'https://central.test'])
        self.assertEqual(ctx.exception.code, 2)

    def test_no_credentials_or_bodies_are_sent_or_read(self):
        source = (DEPLOY / 'proxy' / 'live_check.py').read_text()
        for word in ('Authorization', 'Cookie', 'Bearer', '.read()', 'data='):
            self.assertNotIn(word, source)


if __name__ == '__main__':
    unittest.main()
