#!/usr/bin/env python3
"""Signed, staging-only, transaction-rolled-back identity/member backfill rehearsal.

This is NOT a production migration executor: its only execution mode always
ROLLBACKs. The staging manifest identifies an independently reviewed existing
company mapping plus a new identity and membership candidate; the canonical
database is checked again inside the same transaction before writes. HMAC
approval signs the exact manifest digest and expires promptly. No user data
or SQL statements are printed to stdout/stderr.

Usage:
 python3 tools/rehearse_signed_backfill.py --database-url ... \\
   --manifest /secure/manifest.json --approval /secure/approval.json \\
   --execute-staging-rehearsal
Environment:
 TITAN_BACKFILL_STAGING_ENABLED=1
 TITAN_BACKFILL_APPROVAL_KEY=<hex-encoded random 32-byte HMAC secret>

Even fully valid approval can never produce COMMIT.
"""
import argparse
import hashlib
import hmac
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit, unquote

UUID=re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',re.I)
SUBJECT=re.compile(r'^[^\s\x00-\x1f\x7f]{1,256}$')
ROLES={'owner','admin','manager','member','learner'}
ALLOWED={'company_id','legacy_organisation_id','logto_organisation_id',
         'identity_id','logto_subject','identity_status','membership_role'}
APPROVAL_FIELDS={'manifest_sha256','expires_at_unix','signature'}
MAX_MANIFEST_BYTES=8192

class RehearsalError(Exception):
    pass

def canonical_json(obj):
    return json.dumps(obj,sort_keys=True,separators=(',',':'),ensure_ascii=True)

def digest(manifest):
    return hashlib.sha256(canonical_json(manifest).encode()).hexdigest()

def validate_manifest(manifest):
    if not isinstance(manifest,dict) or set(manifest)!=ALLOWED:
        raise RehearsalError('manifest fields invalid')
    for field in ('company_id','legacy_organisation_id','identity_id'):
        if not isinstance(manifest[field],str) or not UUID.fullmatch(manifest[field]):
            raise RehearsalError('manifest UUID invalid')
    if not isinstance(manifest['logto_subject'],str) or not SUBJECT.fullmatch(manifest['logto_subject']):
        raise RehearsalError('identity subject invalid')
    org=manifest['logto_organisation_id']
    if not isinstance(org,str) or not SUBJECT.fullmatch(org):
        raise RehearsalError('organisation identifier invalid')
    if manifest['identity_status']!='active' or manifest['membership_role'] not in ROLES:
        raise RehearsalError('unsupported identity state or membership role')
    return manifest

def verify_approval(manifest,approval,key_hex,*,now=None):
    validate_manifest(manifest)
    if not isinstance(approval,dict) or set(approval)!=APPROVAL_FIELDS:
        raise RehearsalError('approval fields invalid')
    if not isinstance(key_hex,str) or not re.fullmatch(r'[0-9a-fA-F]{64}',key_hex):
        raise RehearsalError('32-byte approval secret required')
    expiry=approval['expires_at_unix']
    instant=int(time.time() if now is None else now)
    if type(expiry) is not int or expiry<=instant or expiry>instant+900:
        raise RehearsalError('approval expired or too far in future')
    if approval['manifest_sha256']!=digest(manifest):
        raise RehearsalError('manifest approval digest mismatch')
    sig=approval['signature']
    if not isinstance(sig,str) or not re.fullmatch(r'[0-9a-f]{64}',sig):
        raise RehearsalError('approval signature malformed')
    # Domain-separate this signature from any other HMAC application.
    payload='titan:staging-backfill-rehearsal:v1:'+str(expiry)+':'+approval['manifest_sha256']
    expected=hmac.new(bytes.fromhex(key_hex),payload.encode(),hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig,expected):
        raise RehearsalError('approval signature rejected')
    return True

def staging_database(url):
    try:
        parsed=urlsplit(url)
        name=unquote(parsed.path[1:])
    except (ValueError,AttributeError):
        raise RehearsalError('invalid staging PostgreSQL URL')
    # Limit the exact *database name*; this is a defence-in-depth gate, not
    # the sole environment safety boundary.
    if parsed.scheme not in ('postgres','postgresql') or not parsed.hostname or (
        name not in ('titan_shared_ci','titan_shared_staging','titan_shared_backfill_ci')
    ) or parsed.fragment:
        raise RehearsalError('only dedicated canonical staging databases permitted')
    return name

def literal(value):
    # Values are strictly schema-validated first. Double SQL quotes and
    # disable standard_conforming_strings ambiguity before any DML.
    return "'" + value.replace("'","''") + "'"

def render(manifest):
    validate_manifest(manifest)
    q={key:literal(str(value)) for key,value in manifest.items()}
    # A single DO block raises on *any* missing/mismatched mapping, inactive
    # company, already-existing identity or membership. No UPDATE/UPSERT.
    return f"""BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
SET LOCAL standard_conforming_strings = on;
SET LOCAL statement_timeout = '5000ms';
SELECT pg_advisory_xact_lock(884201, 1601);
DO $rehearsal$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM titan.central_legacy_company_links AS l
    JOIN titan.companies AS c ON c.id=l.company_id
    WHERE l.legacy_organisation_id={q['legacy_organisation_id']}::uuid
      AND l.company_id={q['company_id']}::uuid
      AND l.logto_organisation_id={q['logto_organisation_id']}
      AND l.status='verified' AND l.verified_at IS NOT NULL
      AND c.status='active'
  ) THEN RAISE EXCEPTION 'verified company link missing'; END IF;
  IF EXISTS(SELECT 1 FROM titan.identities
    WHERE id={q['identity_id']}::uuid
       OR logto_subject={q['logto_subject']})
  THEN RAISE EXCEPTION 'identity already exists'; END IF;
  INSERT INTO titan.identities(id,logto_subject,status) VALUES(
    {q['identity_id']}::uuid,{q['logto_subject']},{q['identity_status']});
  INSERT INTO titan.company_memberships(company_id,identity_id,role,status)
  VALUES({q['company_id']}::uuid,{q['identity_id']}::uuid,
    {q['membership_role']},'active');
  IF (SELECT count(*) FROM titan.company_memberships
      WHERE company_id={q['company_id']}::uuid
      AND identity_id={q['identity_id']}::uuid)<>1
  THEN RAISE EXCEPTION 'rehearsal membership not inserted'; END IF;
END $rehearsal$;
ROLLBACK;
"""

def rehearse(url,manifest,approval,key_hex,*,psql='psql',env=None):
    enabled=os.environ if env is None else env
    if enabled.get('TITAN_BACKFILL_STAGING_ENABLED')!='1':
        raise RehearsalError('staging rehearsal disabled')
    name=staging_database(url)
    verify_approval(manifest,approval,key_hex)
    script=render(manifest)
    try:
        run=subprocess.run([psql,'-X','-q','-v','ON_ERROR_STOP=1','-d',url,'-f','-'],
                           input=script,text=True,capture_output=True,timeout=25,check=False)
    except (OSError,subprocess.TimeoutExpired) as exc:
        raise RehearsalError('staging rehearsal failed to start') from exc
    if run.returncode:
        # Never print server messages: these may contain user IDs/subjects.
        raise RehearsalError('staging transaction rejected; changes rolled back')
    return {'schema':'titan.backfill-rehearsal.v1','status':'rolled_back',
            'database_class':'dedicated_staging','approved_manifest_digest':digest(manifest),
            'records_persisted':0,'production_execution_permitted':False}

def read_json(path):
    data=Path(path).read_bytes()
    if len(data)>MAX_MANIFEST_BYTES:
        raise RehearsalError('input too large')
    return json.loads(data)

def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--database-url',required=True)
    p.add_argument('--manifest',type=Path,required=True)
    p.add_argument('--approval',type=Path,required=True)
    p.add_argument('--execute-staging-rehearsal',action='store_true')
    args=p.parse_args(argv)
    try:
        if not args.execute_staging_rehearsal:
            raise RehearsalError('explicit staging rehearsal flag required')
        result=rehearse(args.database_url,read_json(args.manifest),
            read_json(args.approval),os.environ.get('TITAN_BACKFILL_APPROVAL_KEY'))
        print(canonical_json(result))
        return 0
    except (RehearsalError,ValueError,TypeError,OSError):
        print('staging backfill rehearsal refused or failed',file=sys.stderr)
        return 1

if __name__=='__main__':
    raise SystemExit(main())
