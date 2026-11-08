# Titan Central documentation

## Current documents

- [Architecture and product ownership](../TITAN_ARCHITECTURE_DECISIONS.md)
- [Deployment and integration runbook](../PASS15_DEPLOYMENT_RUNBOOK.md)
- [Repository overview and commands](../README.md)

## Historical pass records

Pass 01–14 implementation notes, source audits, release manifests and deployment gates are archived under [history/passes](history/passes/). They describe earlier snapshots and product names; use the current architecture and runbook for current behavior.

## Source boundaries

The current source workspace is split into the HTTP host (`apps/control-api`) and reusable TypeScript authorization package (`packages/control-plane`). These are npm workspaces in a single repository. Logto remains an external upstream service; the source inventory is not a copy of its upstream code.
