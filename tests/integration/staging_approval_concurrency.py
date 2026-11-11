#!/usr/bin/env python3
"""CI-only: independently authenticated issuer and two concurrent executors.

Uses only CI throwaway PostgreSQL. Never intended for deployment.
Test fails if issuer can execute, executor can approve, duplicate consumption
occurs, audit attribution is wrong, or extra access rows appear.
"""
import concurrent.futures
import os
import re
import subprocess
import sys

DB='titan_shared_ci'
APPROVER='titan_approver_ci_login'
EXECUTOR='titan_backfill_ci_login'
SQL_ID='00000000-0000-4000-8000-000000000807'
SUBJECT='staging-concurrent-approved-subject'
COMPANY='00000000-0000-4000-8000-000000000011'
LEGACY='00000000-0000-4000-8000-000000000001'

def psql(user,statement):
    proc=subprocess.run(
      ['psql','-X','-qAt','-v','ON_ERROR_STOP=1','-h','localhost',
       '-U',user,'-d',DB,'-c',statement],
      capture_output=True,text=True,timeout=35,
      env={**os.environ,'PGPASSWORD':'ci-only-throwaway'})
    return proc.returncode,proc.stdout.strip()

def verify():
    # Issuer can only issue; executor can only consume. Both users exist in
    # the PostgreSQL server with separate login credentials/role memberships.
    banned=[
      (APPROVER,"SET ROLE titan_staging_approval_issuer; SELECT titan.execute_staging_backfill_approval('00000000-0000-4000-8000-000000000999');"),
      (EXECUTOR,"SET ROLE titan_staging_backfill_executor; SELECT titan.issue_staging_backfill_approval('"+LEGACY+"'::uuid,'"+COMPANY+"'::uuid,'logto-company-a','"+SQL_ID+"'::uuid,'bad-subject','member','CI-EXTRA');"),
      (APPROVER,"SET ROLE titan_staging_approval_issuer; SELECT * FROM titan.staging_backfill_approvals;"),
    ]
    for user,sql in banned:
        code,_=psql(user,sql)
        if code==0:raise AssertionError('separation-of-duties bypass')
    sql=("SET ROLE titan_staging_approval_issuer; SELECT "
      "titan.issue_staging_backfill_approval('"+LEGACY+"'::uuid,"
      "'"+COMPANY+"'::uuid,'logto-company-a','"+SQL_ID+"'::uuid,"
      "'"+SUBJECT+"','member','CI-CONCURRENT-007');")
    status,output=psql(APPROVER,sql)
    if status!=0 or not re.fullmatch(r'[0-9a-f-]{36}',output):
        raise AssertionError('independent issuer could not approve')
    approval=output
    call=("SET ROLE titan_staging_backfill_executor; "
      "SELECT titan.execute_staging_backfill_approval('"+approval+"'::uuid);")
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        futures=[pool.submit(psql,EXECUTOR,call) for _ in range(2)]
        results=[f.result() for f in futures]
    if sum(code==0 for code,_ in results)!=1:
        raise AssertionError('concurrent approvals were not exactly-once')
    # Verify with the CI admin account, not either restricted login.
    admin=os.environ['TITAN_SHARED_CI_DATABASE_URL']
    query=("SELECT ("
      "(SELECT count(*) FROM titan.identities WHERE id='"+SQL_ID+"'::uuid)=1"
      " AND (SELECT count(*) FROM titan.company_memberships WHERE "
      "identity_id='"+SQL_ID+"'::uuid AND company_id='"+COMPANY+"'::uuid)=1"
      " AND (SELECT count(*) FROM titan.staging_backfill_audit WHERE approval_id='"
      +approval+"'::uuid AND executing_login='"+EXECUTOR+"')=1"
      " AND (SELECT count(*) FROM titan.staging_backfill_approvals WHERE "
      "approval_id='"+approval+"'::uuid AND approved_by='"+APPROVER
      +"' AND consumed_at IS NOT NULL)=1)::text")
    proc=subprocess.run(['psql','-X','-qAt','-v','ON_ERROR_STOP=1',
       '-d',admin,'-c',query],capture_output=True,text=True,timeout=30)
    if proc.returncode or proc.stdout.strip()!='true':
        raise AssertionError('audit, issuer, executor and committed data not atomic')
    return {'committed':1,'rejected_replays':1,'approval_issued_by_separate_login':True}

def main():
    try:
        print(verify())
        return 0
    except (KeyError,AssertionError,OSError,subprocess.TimeoutExpired):
        print('concurrent staging approval verification failed',file=sys.stderr)
        return 1

if __name__=='__main__':
    raise SystemExit(main())
