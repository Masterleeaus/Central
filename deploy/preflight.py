#!/usr/bin/env python3
"""Read-only Titan Central deployment gate. Never reads secrets or changes services.

Usage:
  python3 deploy/preflight.py --config deploy/staging.example.json \
      [--root /path/to/extract --upstream /path/to/logto-checkout] \
      [--live /home/admin/apps]

  --root      extract that contains the titan-central/ source tree.
  --upstream  explicit path to an upstream Logto checkout (must contain LICENSE).
              Required whenever --root is given; a missing path is a failure.
  --live      parent directory of the live applications. Subdirectory names come
              from the config key live_app_dirs; deferred apps are not checked.

Config keys:
  deferred_apps         list of apps not blocking this release (only 'academy' may be deferred).
  provisioned_hostnames hostnames that exist on the server; every hostname in
                        oidc_origin, central_origin and blocking app origins must be listed.
  live_app_dirs         app name -> directory name under --live.
"""
from __future__ import annotations
import argparse
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

APPS = ('desk','field','academy')
DEFERRABLE_APPS = ('academy',)
FLAG_KEYS = ('central_db_separate','logto_db_separate','supported_postgres',
             'real_logto_verified','migration_verified','two_tenant_test_passed',
             'global_logout_test_passed','rollback_test_passed')
NEEDED = ('oidc_origin','central_origin','app_origins','callback_paths','logout_paths',
          'deferred_apps','provisioned_hostnames','live_app_dirs','app_adapter_implemented') + FLAG_KEYS
_HOST_RE = re.compile(r'^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$')
_DIR_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')


def validate_origin(value: str) -> bool:
    if not isinstance(value,str): return False
    try:
        u=urlsplit(value)
        return u.scheme=='https' and bool(u.hostname) and u.netloc==u.hostname and not u.username and not u.password and not u.port and not u.path.rstrip('/') and not u.query and not u.fragment
    except ValueError:
        return False


def validate_route(route: str) -> bool:
    if not isinstance(route,str) or not route.startswith('/') or route.startswith('//') or len(route)>180: return False
    return not any(x in route for x in ('\\','?','#','..','%','//')) and all(32<ord(x)<127 for x in route)


def validate_hostname(value) -> bool:
    return isinstance(value,str) and len(value)<=253 and bool(_HOST_RE.match(value))


def validate_dirname(value) -> bool:
    return isinstance(value,str) and bool(_DIR_RE.match(value)) and '..' not in value


def _deferred_apps(config: dict, issues: list) -> set:
    raw=config.get('deferred_apps')
    if not isinstance(raw,list) or not all(isinstance(a,str) for a in raw) or len(set(raw))!=len(raw) or not set(raw)<=set(DEFERRABLE_APPS):
        issues.append('invalid_deferred_apps')
        return set()  # fail closed: nothing is deferred when the list is malformed
    return set(raw)


def assess(config: dict, root: Path | None = None, live: Path | None = None, upstream: Path | None = None) -> dict:
    issues=[]
    if not isinstance(config,dict): return {'ready':False,'issues':['invalid_configuration'],'checked':0}
    for k in NEEDED:
        if k not in config: issues.append('missing:'+k)
    blocking=set(APPS)-_deferred_apps(config,issues)

    for k in ('oidc_origin','central_origin'):
        if not validate_origin(config.get(k)): issues.append('invalid_origin:'+k)
    origins=config.get('app_origins')
    if not isinstance(origins,dict) or set(origins)!=set(APPS):
        issues.append('invalid_app_origins')
    else:
        if any(not validate_origin(v) for v in origins.values()): issues.append('invalid_app_origin')
        all_origins=list(origins.values())+[config.get('oidc_origin'),config.get('central_origin')]
        if len(set(all_origins))!=len(all_origins): issues.append('duplicate_origin')

    hosts=config.get('provisioned_hostnames')
    if not isinstance(hosts,list) or not all(validate_hostname(h) for h in hosts):
        issues.append('invalid_provisioned_hostnames')
        hosts=[]
    named={'oidc_origin':config.get('oidc_origin'),'central_origin':config.get('central_origin')}
    if isinstance(origins,dict):
        for app in blocking: named['app_origins.'+app]=origins.get(app)
    for name,value in named.items():
        if validate_origin(value) and urlsplit(value).hostname not in hosts:
            issues.append('unprovisioned_host:'+name)

    for key in ('callback_paths','logout_paths'):
        routes=config.get(key)
        if not isinstance(routes,dict) or set(routes)!=set(APPS) or not all(validate_route(v) for v in routes.values()):
            issues.append('invalid_routes:'+key)

    for key in FLAG_KEYS:
        if config.get(key) is not True: issues.append('unverified:'+key)
    adapters=config.get('app_adapter_implemented')
    if not isinstance(adapters,dict) or set(adapters)!=set(APPS):
        issues.append('invalid_app_adapter_implemented')
    else:
        for app in sorted(blocking):
            if adapters.get(app) is not True: issues.append('unverified:app_adapter_implemented.'+app)

    live_dirs=config.get('live_app_dirs')
    if not isinstance(live_dirs,dict) or set(live_dirs)!=set(APPS) or not all(validate_dirname(v) for v in live_dirs.values()):
        issues.append('invalid_live_app_dirs')
        live_dirs=None

    if root is not None:
        for rel in ('titan-central/apps/control-api/src/server.mjs',
                    'titan-central/packages/control-plane/src/index.ts',
                    'titan-central/migrations/0004_session_revocations_draft.sql'):
            if not (root/rel).is_file(): issues.append('missing_source:'+rel)
        manifest=root/'titan-central'/'PASS14_RELEASE_MANIFEST.json'
        if not manifest.is_file(): issues.append('missing_pass14_manifest')
        else:
            try:
                data=json.loads(manifest.read_text())
                if data.get('pass')!=14: issues.append('unexpected_baseline')
            except (ValueError,OSError,AttributeError): issues.append('invalid_baseline_manifest')
    if upstream is not None:
        if not upstream.is_dir() or not (upstream/'LICENSE').is_file(): issues.append('missing_upstream')
    elif root is not None:
        issues.append('missing_upstream_argument')

    if live is not None and live_dirs is not None:
        for app in sorted(blocking):
            if not (live/live_dirs[app]).is_dir(): issues.append('missing_live_app:'+app)
    return {'ready':not issues, 'issues':sorted(set(issues)),'checked':len(NEEDED)}


# Operator plane (issue #73). Read-only check of the environment file. Reports variable NAMES only, never values.
OPERATOR_ID_KEYS=('TITAN_OPERATOR_ORGANISATION_ID','TITAN_OPERATOR_ROLE_IDS')
LOGTO_MANAGEMENT_KEYS=('TITAN_LOGTO_MANAGEMENT_ORIGIN','TITAN_LOGTO_M2M_CLIENT_ID','TITAN_LOGTO_M2M_CLIENT_SECRET',
                       'TITAN_LOGTO_MANAGEMENT_RESOURCE','TITAN_LOGTO_MANAGEMENT_SCOPE')
_PLACEHOLDER='REPLACE_ME'


def read_env_file(path: Path) -> dict:
    """Parses KEY=VALUE lines the way systemd EnvironmentFile= reads them for plain values. Comments and blank lines are skipped."""
    values={}
    for raw in path.read_text().splitlines():
        line=raw.strip()
        if not line or line.startswith('#') or '=' not in line: continue
        key,_,value=line.partition('=')
        values[key.strip()]=value
    return values


def assess_env(env: dict) -> dict:
    """Fails when any TITAN_OPERATOR_* variable is set but the operator or Logto management values are incomplete.
    An unset operator plane passes. A REPLACE_ME value counts as missing. Issues name variables only."""
    issues=[]
    operator_on=any(env.get(k,'')!='' for k in OPERATOR_ID_KEYS)
    if operator_on:
        for key in OPERATOR_ID_KEYS+LOGTO_MANAGEMENT_KEYS:
            value=env.get(key,'')
            if value.strip()=='': issues.append('operator_incomplete:'+key)
            elif value==_PLACEHOLDER: issues.append('operator_placeholder:'+key)
        origin=env.get('TITAN_LOGTO_MANAGEMENT_ORIGIN','')
        if origin not in ('',_PLACEHOLDER) and not validate_origin(origin): issues.append('invalid_origin:TITAN_LOGTO_MANAGEMENT_ORIGIN')
        resource=env.get('TITAN_LOGTO_MANAGEMENT_RESOURCE','')
        if resource not in ('',_PLACEHOLDER) and not resource.startswith('https://'): issues.append('invalid_resource:TITAN_LOGTO_MANAGEMENT_RESOURCE')
    return {'ready':not issues,'issues':sorted(set(issues)),'checked':len(OPERATOR_ID_KEYS)+len(LOGTO_MANAGEMENT_KEYS)}


def main():
    p=argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--config',type=Path)
    p.add_argument('--env-file',type=Path,help='central.env to check for operator configuration completeness')
    p.add_argument('--root',type=Path)
    p.add_argument('--upstream',type=Path)
    p.add_argument('--live',type=Path)
    a=p.parse_args()
    if a.config is None and a.env_file is None: p.error('one of --config or --env-file is required')
    results=[]
    if a.config is not None:
        try:
            config=json.loads(a.config.read_text())
        except (OSError,ValueError):
            print(json.dumps({'ready':False,'issues':['unreadable_configuration']}));raise SystemExit(2)
        results.append(assess(config,a.root,a.live,a.upstream))
    if a.env_file is not None:
        try:
            results.append(assess_env(read_env_file(a.env_file)))
        except (OSError,UnicodeDecodeError):
            print(json.dumps({'ready':False,'issues':['unreadable_env_file']}));raise SystemExit(2)
    result={'ready':all(r['ready'] for r in results),
            'issues':sorted({i for r in results for i in r['issues']}),
            'checked':sum(r['checked'] for r in results)}
    print(json.dumps(result,indent=2))
    raise SystemExit(0 if result['ready'] else 1)


if __name__=='__main__':main()
