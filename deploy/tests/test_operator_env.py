import json
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

DEPLOY=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(DEPLOY))
from preflight import OPERATOR_ID_KEYS, LOGTO_MANAGEMENT_KEYS, assess_env, read_env_file
EXAMPLE=DEPLOY/'env.example'
PREFLIGHT=DEPLOY/'preflight.py'
SECRET='fixture-m2m-secret-DO-NOT-LEAK-4a1f'

COMPLETE={
    'TITAN_OPERATOR_ORGANISATION_ID':'tc5p1zpq21uu',
    'TITAN_OPERATOR_ROLE_IDS':'wocrsarwp3tw2khe42kbi',
    'TITAN_LOGTO_MANAGEMENT_ORIGIN':'https://auth.titanzero.io',
    'TITAN_LOGTO_M2M_CLIENT_ID':'m2m-client-fixture',
    'TITAN_LOGTO_M2M_CLIENT_SECRET':SECRET,
    'TITAN_LOGTO_MANAGEMENT_RESOURCE':'https://auth.titanzero.io/api',
    'TITAN_LOGTO_MANAGEMENT_SCOPE':'all',
}


class OperatorEnvTests(unittest.TestCase):
    def test_unset_operator_plane_passes(self):
        self.assertTrue(assess_env({})['ready'])

    def test_logto_values_without_operator_ids_pass(self):
        env={k:v for k,v in COMPLETE.items() if k not in OPERATOR_ID_KEYS}
        self.assertTrue(assess_env(env)['ready'])

    def test_complete_example_passes(self):
        result=assess_env(dict(COMPLETE))
        self.assertTrue(result['ready'])
        self.assertEqual(result['issues'],[])
        self.assertEqual(result['checked'],len(OPERATOR_ID_KEYS)+len(LOGTO_MANAGEMENT_KEYS))

    def test_each_missing_value_fails_and_is_named(self):
        for key in OPERATOR_ID_KEYS+LOGTO_MANAGEMENT_KEYS:
            with self.subTest(key=key):
                env=dict(COMPLETE); del env[key]
                result=assess_env(env)
                self.assertFalse(result['ready'])
                self.assertIn('operator_incomplete:'+key,result['issues'])

    def test_each_empty_value_fails(self):
        for key in OPERATOR_ID_KEYS+LOGTO_MANAGEMENT_KEYS:
            with self.subTest(key=key):
                env=dict(COMPLETE); env[key]=''
                self.assertIn('operator_incomplete:'+key,assess_env(env)['issues'])

    def test_each_placeholder_value_fails(self):
        for key in OPERATOR_ID_KEYS+LOGTO_MANAGEMENT_KEYS:
            with self.subTest(key=key):
                env=dict(COMPLETE); env[key]='REPLACE_ME'
                self.assertIn('operator_placeholder:'+key,assess_env(env)['issues'])

    def test_management_origin_must_be_bare_https_origin(self):
        env=dict(COMPLETE); env['TITAN_LOGTO_MANAGEMENT_ORIGIN']='https://auth.titanzero.io/api'
        self.assertIn('invalid_origin:TITAN_LOGTO_MANAGEMENT_ORIGIN',assess_env(env)['issues'])

    def test_management_resource_must_be_https(self):
        env=dict(COMPLETE); env['TITAN_LOGTO_MANAGEMENT_RESOURCE']='http://auth.titanzero.io/api'
        self.assertIn('invalid_resource:TITAN_LOGTO_MANAGEMENT_RESOURCE',assess_env(env)['issues'])

    def test_issues_never_contain_the_secret(self):
        env=dict(COMPLETE); env['TITAN_LOGTO_MANAGEMENT_ORIGIN']='https://auth.titanzero.io/api'
        del env['TITAN_LOGTO_MANAGEMENT_SCOPE']
        self.assertNotIn(SECRET,json.dumps(assess_env(env)))

    def test_shipped_template_blocks_until_filled(self):
        result=assess_env(read_env_file(EXAMPLE))
        self.assertFalse(result['ready'])
        self.assertIn('operator_placeholder:TITAN_OPERATOR_ORGANISATION_ID',result['issues'])
        self.assertIn('operator_placeholder:TITAN_LOGTO_M2M_CLIENT_SECRET',result['issues'])

    def test_shipped_template_with_operator_plane_off_passes(self):
        env=read_env_file(EXAMPLE)
        env['TITAN_OPERATOR_ORGANISATION_ID']=''
        env['TITAN_OPERATOR_ROLE_IDS']=''
        self.assertTrue(assess_env(env)['ready'])

    def test_template_example_values_are_the_owner_values(self):
        env=read_env_file(EXAMPLE)
        self.assertEqual(env['TITAN_LOGTO_MANAGEMENT_RESOURCE'],'https://auth.titanzero.io/api')
        self.assertEqual(env['TITAN_LOGTO_MANAGEMENT_SCOPE'],'all')

    def test_reader_skips_comments_and_commented_examples(self):
        with TemporaryDirectory() as tmp:
            path=Path(tmp)/'central.env'
            path.write_text('# TITAN_OPERATOR_ORGANISATION_ID=tc5p1zpq21uu\n\nTITAN_CENTRAL_PORT=3102\nnot a pair\n')
            self.assertEqual(read_env_file(path),{'TITAN_CENTRAL_PORT':'3102'})


class OperatorEnvCliTests(unittest.TestCase):
    def run_cli(self, env):
        with TemporaryDirectory() as tmp:
            path=Path(tmp)/'central.env'
            path.write_text(''.join(f'{k}={v}\n' for k,v in env.items()))
            return subprocess.run([sys.executable,'-I',str(PREFLIGHT),'--env-file',str(path)],capture_output=True,text=True)

    def test_complete_file_exits_zero(self):
        proc=self.run_cli(COMPLETE)
        self.assertEqual(proc.returncode,0,proc.stdout+proc.stderr)
        self.assertTrue(json.loads(proc.stdout)['ready'])

    def test_missing_value_exits_one_and_prints_no_value(self):
        env=dict(COMPLETE); del env['TITAN_LOGTO_M2M_CLIENT_ID']
        proc=self.run_cli(env)
        self.assertEqual(proc.returncode,1)
        self.assertIn('operator_incomplete:TITAN_LOGTO_M2M_CLIENT_ID',json.loads(proc.stdout)['issues'])
        self.assertNotIn(SECRET,proc.stdout+proc.stderr)

    def test_unreadable_file_exits_two(self):
        proc=subprocess.run([sys.executable,'-I',str(PREFLIGHT),'--env-file','/nonexistent/central.env'],capture_output=True,text=True)
        self.assertEqual(proc.returncode,2)
        self.assertIn('unreadable_env_file',proc.stdout)

    def test_requires_one_input(self):
        proc=subprocess.run([sys.executable,'-I',str(PREFLIGHT)],capture_output=True,text=True)
        self.assertEqual(proc.returncode,2)


if __name__=='__main__':
    unittest.main()
