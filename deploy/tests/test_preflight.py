import sys
import unittest
import json
from pathlib import Path
from tempfile import TemporaryDirectory
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from preflight import assess,validate_origin,validate_route
EXAMPLE=Path(__file__).resolve().parents[1]/'staging.example.json'
class GateTests(unittest.TestCase):
  def setUp(self): self.data=json.loads(EXAMPLE.read_text())
  def ready(self):
    for name in ('central_db_separate','logto_db_separate','supported_postgres','real_logto_verified','migration_verified','two_tenant_test_passed','global_logout_test_passed','rollback_test_passed'): self.data[name]=True
    self.data['app_adapter_implemented']={a:True for a in ('supercharged','sorted','lms')}
  def test_example_blocks(self): self.assertFalse(assess(self.data)['ready'])
  def test_full_config_ready(self): self.ready();self.assertTrue(assess(self.data)['ready'])
  def test_missing_field_blocks(self): self.ready();del self.data['central_origin'];self.assertFalse(assess(self.data)['ready'])
  def test_missing_adapter_blocks(self): self.ready();self.data['app_adapter_implemented']['lms']=False;self.assertFalse(assess(self.data)['ready'])
  def test_missing_tenant_gate_blocks(self): self.ready();self.data['two_tenant_test_passed']=False;self.assertFalse(assess(self.data)['ready'])
  def test_missing_logout_gate_blocks(self): self.ready();self.data['global_logout_test_passed']=False;self.assertFalse(assess(self.data)['ready'])
  def test_duplicate_origin_blocks(self): self.ready();self.data['app_origins']['lms']=self.data['app_origins']['supercharged'];self.assertFalse(assess(self.data)['ready'])
  def test_insecure_origin_blocks(self): self.ready();self.data['oidc_origin']='http://identity.titanzero.io';self.assertFalse(assess(self.data)['ready'])
  def test_origin_with_credentials_blocks(self): self.assertFalse(validate_origin('https://alice:secret@example.com'))
  def test_origin_with_nondefault_port_blocks(self): self.assertFalse(validate_origin('https://example.com:8443'))
  def test_route_external_blocks(self): self.assertFalse(validate_route('//evil.example/'))
  def test_route_traversal_blocks(self): self.assertFalse(validate_route('/auth/../admin'))
  def test_unexpected_app_blocks(self): self.ready();self.data['app_origins']['other']='https://other.example';self.assertFalse(assess(self.data)['ready'])
  def test_missing_source_blocks(self): self.ready();
  def test_missing_live_apps_blocks(self):
    self.ready()
    with TemporaryDirectory() as d: self.assertFalse(assess(self.data,live=Path(d))['ready'])
  def test_wrong_boolean_type_blocks(self): self.ready();self.data['supported_postgres']='true';self.assertFalse(assess(self.data)['ready'])
if __name__=='__main__':unittest.main()
