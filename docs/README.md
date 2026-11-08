# Titan Central documentation

## Current documents

- [Architecture and product ownership](../TITAN_ARCHITECTURE_DECISIONS.md)
- [Deployment and integration runbook](../PASS15_DEPLOYMENT_RUNBOOK.md)
- [Repository overview and commands](../README.md)

## Historical pass records

Pass 01–14 implementation notes, source audits, release manifests and deployment gates are archived under [history/passes](history/passes/). They describe earlier snapshots and product names; use the current architecture and runbook for current behavior.

## Source boundaries

This repository is the Titan Central application source. The current source workspace is split into the HTTP host (`apps/control-api`) and reusable TypeScript authorization package (`packages/control-plane/src`), both managed as npm workspaces. Logto is an external runtime identity service, not a missing part of the Central app source.
