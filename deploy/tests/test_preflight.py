import json
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

DEPLOY=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(DEPLOY))
from preflight import APPS, FLAG_KEYS, NEEDED, assess, validate_dirname, validate_hostname, validate_origin, validate_route
EXAMPLE=DEPLOY/'staging.example.json'
PREFLIGHT=DEPLOY/'preflight.py'


def make_root(base: Path, pass_number=14, omit=()):
    """Create a minimal fake extract with the Central source files the gate looks for."""
    files={
        'titan-central/apps/control-api/src/server.mjs':'',
        'titan-central/packages/control-plane/src/index.ts':'',
        'titan-central/migrations/0004_session_revocations_draft.sql':'',
    }
    for rel,text in files.items():
        if rel in omit: continue
        p=base/rel; p.parent.mkdir(parents=True,exist_ok=True); p.write_text(text)
    if 'titan-central/docs/records/pass/PASS14_RELEASE_MANIFEST.json' not in omit:
        (base/'titan-central'/'docs'/'records'/'pass').mkdir(parents=True,exist_ok=True)
        (base/'titan-central'/'docs'/'records'/'pass'/'PASS14_RELEASE_MANIFEST.json').write_text(json.dumps({'pass':pass_number}))
    return base


def make_upstream(base: Path, with_license=True):
    base.mkdir(parents=True,exist_ok=True)
    if with_license: (base/'LICENSE').write_text('MPL-2.0')
    return base


def make_live(base: Path, dirs):
    for d in dirs: (base/d).mkdir(parents=True,exist_ok=True)
    return base


class GateTests(unittest.TestCase):
    def setUp(self):
        self.data=json.loads(EXAMPLE.read_text())

    def ready(self):
        for name in FLAG_KEYS: self.data[name]=True
        self.data['app_adapter_implemented']={a:True for a in APPS}

    def issues(self, **kwargs):
        return assess(self.data, **kwargs)['issues']

    # Example and happy path
    def test_example_blocks(self):
        self.assertFalse(assess(self.data)['ready'])

    def test_full_config_ready(self):
        self.ready()
        self.assertTrue(assess(self.data)['ready'])

    def test_full_gate_ready_with_all_inputs(self):
        self.ready()
        with TemporaryDirectory() as d:
            base=Path(d)
            root=make_root(base/'extract')
            upstream=make_upstream(base/'logto')
            live=make_live(base/'live',['desk','ai-fsm'])
            result=assess(self.data,root=root,live=live,upstream=upstream)
        self.assertEqual(result['issues'],[])
        self.assertTrue(result['ready'])

    def test_checked_count_matches_needed(self):
        self.assertEqual(assess(self.data)['checked'],len(NEEDED))

    # Required keys are checked by name
    def test_each_needed_key_is_required(self):
        self.ready()
        for key in NEEDED:
            with self.subTest(key=key):
                data=dict(self.data); del data[key]
                result=assess(data)
                self.assertFalse(result['ready'])
                self.assertIn('missing:'+key,result['issues'])

    def test_each_flag_must_be_true(self):
        self.ready()
        for key in FLAG_KEYS:
            with self.subTest(key=key):
                data=dict(self.data); data[key]=False
                self.assertIn('unverified:'+key,assess(data)['issues'])

    def test_wrong_boolean_type_blocks(self):
        self.ready(); self.data['supported_postgres']='true'
        self.assertFalse(assess(self.data)['ready'])

    def test_non_dict_configuration_blocks(self):
        self.assertEqual(assess(['not','a','dict'])['issues'],['invalid_configuration'])

    # Adapters and deferred apps
    def test_missing_adapter_for_live_app_blocks(self):
        self.ready(); self.data['app_adapter_implemented']['desk']=False
        self.assertIn('unverified:app_adapter_implemented.desk',self.issues())

    def test_malformed_adapter_map_blocks(self):
        self.ready(); self.data['app_adapter_implemented']={'desk':True}
        self.assertIn('invalid_app_adapter_implemented',self.issues())

    def test_deferred_academy_does_not_block_adapter(self):
        self.ready(); self.data['app_adapter_implemented']['academy']=False
        self.assertTrue(assess(self.data)['ready'])

    def test_deferred_academy_does_not_block_missing_live_dir(self):
        self.ready()
        with TemporaryDirectory() as d:
            root=make_root(Path(d)/'x'); upstream=make_upstream(Path(d)/'u')
            live=make_live(Path(d)/'live',['desk','ai-fsm'])
            self.assertTrue(assess(self.data,root=root,live=live,upstream=upstream)['ready'])

    def test_deferred_academy_host_need_not_be_provisioned(self):
        self.ready(); self.data['provisioned_hostnames']=['auth.titanzero.io','central.titanzero.io','desk.titanzero.io','field.titanzero.io']
        self.assertTrue(assess(self.data)['ready'])

    def test_undeferred_academy_blocks_without_adapter(self):
        self.ready(); self.data['deferred_apps']=[]; self.data['app_adapter_implemented']['academy']=False
        self.assertIn('unverified:app_adapter_implemented.academy',self.issues())

    def test_undeferred_academy_unprovisioned_host_blocks(self):
        self.ready(); self.data['deferred_apps']=[]
        self.assertIn('unprovisioned_host:app_origins.academy',self.issues())

    def test_desk_cannot_be_deferred(self):
        self.ready(); self.data['deferred_apps']=['desk']
        self.assertIn('invalid_deferred_apps',self.issues())

    def test_malformed_deferred_list_fails_closed(self):
        self.ready(); self.data['deferred_apps']='academy'
        result=assess(self.data)
        self.assertIn('invalid_deferred_apps',result['issues'])
        self.assertFalse(result['ready'])

    # Hostnames (issue 22)
    def test_old_identity_hostname_blocks(self):
        self.ready(); self.data['oidc_origin']='https://identity.titanzero.io'
        self.assertIn('unprovisioned_host:oidc_origin',self.issues())

    def test_canonical_auth_hostname_passes(self):
        self.ready(); self.assertEqual(self.data['oidc_origin'],'https://auth.titanzero.io')
        self.assertNotIn('unprovisioned_host:oidc_origin',self.issues())

    def test_unprovisioned_central_host_blocks(self):
        self.ready(); self.data['central_origin']='https://other.titanzero.io'
        self.assertIn('unprovisioned_host:central_origin',self.issues())

    def test_invalid_provisioned_hostname_blocks(self):
        self.ready(); self.data['provisioned_hostnames'].append('*.titanzero.io')
        self.assertIn('invalid_provisioned_hostnames',self.issues())

    def test_hostname_validator(self):
        self.assertTrue(validate_hostname('auth.titanzero.io'))
        self.assertFalse(validate_hostname('*.titanzero.io'))
        self.assertFalse(validate_hostname('localhost'))
        self.assertFalse(validate_hostname('Auth.TitanZero.io'))

    # Origins and routes
    def test_missing_field_blocks(self):
        self.ready(); del self.data['central_origin']
        self.assertFalse(assess(self.data)['ready'])

    def test_missing_tenant_gate_blocks(self):
        self.ready(); self.data['two_tenant_test_passed']=False
        self.assertFalse(assess(self.data)['ready'])

    def test_missing_logout_gate_blocks(self):
        self.ready(); self.data['global_logout_test_passed']=False
        self.assertFalse(assess(self.data)['ready'])

    def test_duplicate_origin_blocks(self):
        self.ready(); self.data['app_origins']['academy']=self.data['app_origins']['desk']
        self.assertIn('duplicate_origin',self.issues())

    def test_insecure_origin_blocks(self):
        self.ready(); self.data['oidc_origin']='http://auth.titanzero.io'
        self.assertIn('invalid_origin:oidc_origin',self.issues())

    def test_origin_with_credentials_blocks(self):
        self.assertFalse(validate_origin('https://alice:secret@example.com'))

    def test_origin_with_nondefault_port_blocks(self):
        self.assertFalse(validate_origin('https://example.com:8443'))

    def test_route_external_blocks(self):
        self.assertFalse(validate_route('//evil.example/'))

    def test_route_traversal_blocks(self):
        self.assertFalse(validate_route('/auth/../admin'))

    def test_unexpected_app_blocks(self):
        self.ready(); self.data['app_origins']['other']='https://other.example'
        self.assertIn('invalid_app_origins',self.issues())

    def test_invalid_route_map_blocks(self):
        self.ready(); self.data['callback_paths']['desk']='/auth/../desk'
        self.assertIn('invalid_routes:callback_paths',self.issues())

    # Live application directories (issue 23)
    def test_live_dirs_are_config_driven(self):
        self.ready()
        with TemporaryDirectory() as d:
            root=make_root(Path(d)/'x'); upstream=make_upstream(Path(d)/'u')
            # Default name 'ai-fsm' is absent; the config says field lives in 'custom-field'.
            live=make_live(Path(d)/'live',['desk','custom-field'])
            self.assertIn('missing_live_app:field',assess(self.data,root=root,live=live,upstream=upstream)['issues'])
            self.data['live_app_dirs']['field']='custom-field'
            self.assertTrue(assess(self.data,root=root,live=live,upstream=upstream)['ready'])

    def test_missing_live_app_blocks(self):
        self.ready()
        with TemporaryDirectory() as d:
            live=make_live(Path(d),['desk'])
            self.assertIn('missing_live_app:field',assess(self.data,live=live)['issues'])

    def test_missing_live_dir_for_desk_blocks(self):
        self.ready()
        with TemporaryDirectory() as d:
            self.assertIn('missing_live_app:desk',assess(self.data,live=Path(d))['issues'])

    def test_traversal_in_live_dir_blocks(self):
        self.ready(); self.data['live_app_dirs']['field']='../etc'
        self.assertIn('invalid_live_app_dirs',self.issues())

    def test_dirname_validator(self):
        self.assertTrue(validate_dirname('ai-fsm'))
        self.assertFalse(validate_dirname('a/b'))
        self.assertFalse(validate_dirname('..'))
        self.assertFalse(validate_dirname(''))

    # Upstream Logto (issue 23 and 24)
    def test_root_without_upstream_argument_blocks(self):
        self.ready()
        with TemporaryDirectory() as d:
            root=make_root(Path(d))
            self.assertIn('missing_upstream_argument',assess(self.data,root=root)['issues'])

    def test_missing_upstream_path_is_clear_failure(self):
        self.ready()
        with TemporaryDirectory() as d:
            root=make_root(Path(d)/'x')
            result=assess(self.data,root=root,upstream=Path(d)/'does-not-exist')
            self.assertIn('missing_upstream',result['issues'])
            self.assertFalse(result['ready'])

    def test_upstream_without_license_blocks(self):
        self.ready()
        with TemporaryDirectory() as d:
            root=make_root(Path(d)/'x'); upstream=make_upstream(Path(d)/'u',with_license=False)
            self.assertIn('missing_upstream',assess(self.data,root=root,upstream=upstream)['issues'])

    def test_upstream_is_not_required_without_root(self):
        self.ready()
        self.assertTrue(assess(self.data)['ready'])

    # Central source tree and baseline manifest
    def test_missing_source_blocks(self):
        self.ready()
        with TemporaryDirectory() as d:
            root=make_root(Path(d),omit=('titan-central/apps/control-api/src/server.mjs',))
            upstream=make_upstream(Path(d)/'u')
            self.assertIn('missing_source:titan-central/apps/control-api/src/server.mjs',assess(self.data,root=root,upstream=upstream)['issues'])

    def test_missing_pass14_manifest_blocks(self):
        self.ready()
        with TemporaryDirectory() as d:
            root=make_root(Path(d),omit=('titan-central/docs/records/pass/PASS14_RELEASE_MANIFEST.json',))
            upstream=make_upstream(Path(d)/'u')
            self.assertIn('missing_pass14_manifest',assess(self.data,root=root,upstream=upstream)['issues'])

    def test_wrong_baseline_pass_blocks(self):
        self.ready()
        with TemporaryDirectory() as d:
            root=make_root(Path(d),pass_number=13)
            upstream=make_upstream(Path(d)/'u')
            self.assertIn('unexpected_baseline',assess(self.data,root=root,upstream=upstream)['issues'])

    def test_corrupt_baseline_manifest_blocks(self):
        self.ready()
        with TemporaryDirectory() as d:
            root=make_root(Path(d))
            (Path(d)/'titan-central'/'docs'/'records'/'pass'/'PASS14_RELEASE_MANIFEST.json').write_text('{not json')
            upstream=make_upstream(Path(d)/'u')
            self.assertIn('invalid_baseline_manifest',assess(self.data,root=root,upstream=upstream)['issues'])


class CommandLineTests(unittest.TestCase):
    def run_cli(self, *args):
        return subprocess.run([sys.executable,str(PREFLIGHT),*map(str,args)],capture_output=True,text=True)

    def test_unreadable_config_exits_2(self):
        with TemporaryDirectory() as d:
            result=self.run_cli('--config',Path(d)/'missing.json')
        self.assertEqual(result.returncode,2)
        self.assertEqual(json.loads(result.stdout)['issues'],['unreadable_configuration'])

    def test_example_config_exits_1(self):
        result=self.run_cli('--config',EXAMPLE)
        self.assertEqual(result.returncode,1)
        self.assertFalse(json.loads(result.stdout)['ready'])

    def test_root_without_upstream_exits_1(self):
        with TemporaryDirectory() as d:
            root=make_root(Path(d))
            result=self.run_cli('--config',EXAMPLE,'--root',root)
        self.assertEqual(result.returncode,1)
        self.assertIn('missing_upstream_argument',json.loads(result.stdout)['issues'])


if __name__=='__main__':unittest.main()
