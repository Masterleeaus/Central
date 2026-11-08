import json
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from preflight import assess, validate_origin, validate_route

DEPLOY = Path(__file__).resolve().parents[1]
EXAMPLE = DEPLOY / 'staging.example.json'
REPOSITORY_ROOT = DEPLOY.parent


class GateTests(unittest.TestCase):
    def setUp(self):
        self.data = json.loads(EXAMPLE.read_text())

    def ready(self):
        for name in (
            'central_db_separate', 'logto_db_separate', 'supported_postgres',
            'real_logto_verified', 'migration_verified', 'two_tenant_test_passed',
            'global_logout_test_passed', 'rollback_test_passed',
        ):
            self.data[name] = True
        self.data['app_adapter_implemented'] = {app: True for app in ('desk', 'field', 'academy')}

    def test_example_blocks(self):
        self.assertFalse(assess(self.data)['ready'])

    def test_full_config_ready(self):
        self.ready()
        self.assertTrue(assess(self.data)['ready'])

    def test_repository_root_passes_without_upstream_checkout(self):
        self.ready()
        result = assess(self.data, root=REPOSITORY_ROOT)
        self.assertNotIn('missing_source:apps/control-api/src/server.mjs', result['issues'])
        self.assertNotIn('missing_pass14_manifest', result['issues'])

    def test_upstream_license_check_uses_explicit_root(self):
        self.ready()
        with TemporaryDirectory() as directory:
            upstream = Path(directory)
            self.assertIn('missing_upstream_license', assess(self.data, upstream_root=upstream)['issues'])
            (upstream / 'LICENSE').write_text('example')
            self.assertNotIn('missing_upstream_license', assess(self.data, upstream_root=upstream)['issues'])

    def test_missing_field_blocks(self):
        self.ready()
        del self.data['central_origin']
        self.assertFalse(assess(self.data)['ready'])

    def test_missing_adapter_blocks(self):
        self.ready()
        self.data['app_adapter_implemented']['academy'] = False
        self.assertFalse(assess(self.data)['ready'])

    def test_missing_tenant_gate_blocks(self):
        self.ready()
        self.data['two_tenant_test_passed'] = False
        self.assertFalse(assess(self.data)['ready'])

    def test_missing_logout_gate_blocks(self):
        self.ready()
        self.data['global_logout_test_passed'] = False
        self.assertFalse(assess(self.data)['ready'])

    def test_duplicate_origin_blocks(self):
        self.ready()
        self.data['app_origins']['academy'] = self.data['app_origins']['desk']
        self.assertFalse(assess(self.data)['ready'])

    def test_insecure_origin_blocks(self):
        self.ready()
        self.data['oidc_origin'] = 'http://identity.titanzero.io'
        self.assertFalse(assess(self.data)['ready'])

    def test_origin_with_credentials_blocks(self):
        self.assertFalse(validate_origin('https://alice:secret@example.com'))

    def test_origin_with_nondefault_port_blocks(self):
        self.assertFalse(validate_origin('https://example.com:8443'))

    def test_route_external_blocks(self):
        self.assertFalse(validate_route('//evil.example/'))

    def test_route_traversal_blocks(self):
        self.assertFalse(validate_route('/auth/../admin'))

    def test_unexpected_app_blocks(self):
        self.ready()
        self.data['app_origins']['other'] = 'https://other.example'
        self.assertFalse(assess(self.data)['ready'])

    def test_missing_source_blocks(self):
        self.ready()
        with TemporaryDirectory() as directory:
            issues = assess(self.data, root=Path(directory))['issues']
            self.assertIn('missing_source:apps/control-api/src/server.mjs', issues)
            self.assertIn('missing_pass14_manifest', issues)

    def test_missing_live_apps_use_configured_names(self):
        self.ready()
        with TemporaryDirectory() as directory:
            live = Path(directory)
            for app, dirname in self.data['live_app_directories'].items():
                (live / dirname).mkdir()
            self.assertTrue(assess(self.data, live=live)['ready'])

    def test_missing_live_app_blocks(self):
        self.ready()
        with TemporaryDirectory() as directory:
            result = assess(self.data, live=Path(directory))
            self.assertFalse(result['ready'])
            self.assertIn('missing_live_app:desk', result['issues'])

    def test_unsafe_live_directory_blocks(self):
        self.ready()
        self.data['live_app_directories']['desk'] = '../desk'
        self.assertIn('invalid_live_app_directories', assess(self.data)['issues'])

    def test_wrong_boolean_type_blocks(self):
        self.ready()
        self.data['supported_postgres'] = 'true'
        self.assertFalse(assess(self.data)['ready'])


if __name__ == '__main__':
    unittest.main()
