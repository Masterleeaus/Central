import sys
import unittest
from pathlib import Path

PROXY=Path(__file__).resolve().parents[1]/'proxy'
sys.path.insert(0,str(PROXY))
from validate_product_selection import validate,NGINX,APACHE,PRODUCT_PROBES

class ProductSelectionProxyTests(unittest.TestCase):
    def setUp(self):
        self.nginx=NGINX.read_text()
        self.apache=APACHE.read_text()

    def test_product_proxy_templates_require_strict_application_routes(self):
        self.assertEqual(validate(self.nginx,self.apache),[])
        self.assertEqual(len(PRODUCT_PROBES),3)

    def test_nginx_rate_limit_cannot_be_removed(self):
        altered=self.nginx.replace('limit_req zone=titan_company_select burst=8 nodelay;','')
        self.assertTrue(any('request cap' in e for e in validate(altered,self.apache)))

    def test_nginx_concurrency_and_body_limits_are_mandatory(self):
        for directive in ('limit_conn titan_conn 6;','client_max_body_size 4k;'):
            altered=self.nginx.replace(directive,'')
            self.assertTrue(validate(altered,self.apache),directive)

    def test_nginx_must_not_forward_client_supplied_ip(self):
        altered=self.nginx.replace('proxy_set_header X-Forwarded-For $remote_addr;',
                                   'proxy_set_header X-Forwarded-For $http_x_forwarded_for;')
        self.assertTrue(any('forward' in e for e in validate(altered,self.apache)))

    def test_nginx_backend_must_be_product_loopback(self):
        altered=self.nginx.replace('127.0.0.1:__PRODUCT_PORT__','central.example:443')
        self.assertTrue(any('loopback' in e for e in validate(altered,self.apache)))

    def test_apache_requires_product_specific_route_and_concurrency_cap(self):
        altered=self.apache.replace('QS_LocRequestLimitMatch', '# Removed')
        self.assertTrue(any('apache missing product select concurrency' in e
                            for e in validate(self.nginx,altered)))
        altered=self.apache.replace('ProxyPassMatch','# Removed')
        self.assertTrue(any('apache missing product select route' in e
                            for e in validate(self.nginx,altered)))

    def test_apache_wildcard_proxy_is_rejected(self):
        altered=self.apache+'\nProxyPass / http://127.0.0.1:3102/\n'
        self.assertTrue(any('wildcard' in e for e in validate(self.nginx,altered)))

if __name__=='__main__':
    unittest.main()
