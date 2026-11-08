import importlib.util,unittest,tempfile,zipfile,json
from pathlib import Path
p=Path(__file__).resolve().parents[1]/'tools'/'verify_logto_source.py'
spec=importlib.util.spec_from_file_location('source_verify',p);mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class Checks(unittest.TestCase):
    def make(self,license='MPL-2.0',missing=False):
        tmp=tempfile.TemporaryDirectory();path=Path(tmp.name)/'base.zip'
        with zipfile.ZipFile(path,'w') as z:
            z.writestr('logto-master/LICENSE','MPL-2.0')
            z.writestr('logto-master/package.json',json.dumps({'license':license}))
            if not missing:z.writestr('logto-master/packages/core/package.json',json.dumps({'license':'MPL-2.0','version':'1.45.0'}))
            z.writestr('logto-master/pnpm-workspace.yaml','packages: []')
        return tmp,path
    def test_valid(self):
        tmp,p=self.make();self.assertTrue(mod.check(p)['valid']);tmp.cleanup()
    def test_mismatched_hash(self):
        tmp,p=self.make();self.assertFalse(mod.check(p,'0'*64)['valid']);tmp.cleanup()
    def test_missing_required(self):
        tmp,p=self.make(missing=True);self.assertFalse(mod.check(p)['valid']);tmp.cleanup()
    def test_license_change(self):
        tmp,p=self.make(license='Other');self.assertFalse(mod.check(p)['valid']);tmp.cleanup()
if __name__=='__main__':unittest.main()
