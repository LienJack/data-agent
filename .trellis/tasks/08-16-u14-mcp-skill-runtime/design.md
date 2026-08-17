# U14 Technical Design

## Authority split

```text
Admin command -> PostgreSQL MCP/Skill Registry -> immutable Revision/Receipt
Run Effective Config -> exact approved Revision refs -> runtime capability
Tool call -> TaskCapability + egress projection + Effect Intent
  -> SSRF-safe transport -> observed/unknown terminal -> immutable Effect Receipt
Semantic tool adapter -> existing U12/U13/Graph/SQL services
```

## Contracts

`extensions/mcp.ts` owns Server/Tool manifest, trust class, effect semantics, revision refs and dispatch receipts. `extensions/skills.ts` owns immutable package/signer/dependency/capability manifests. Both use strict schemas, canonical hashes and discriminated lifecycle states.

## PostgreSQL

One migration adds append-only revisions, mutable heads, signer revocation and effect intent/terminal records behind NOLOGIN owner/FORCE RLS. Narrow RPCs perform admin CAS, selection, dispatch authorization and reconciliation. Direct browser/worker table DML is denied.

## Runtime and Web

Worker receives server-owned descriptors only after Effective Config and TaskCapability checks. Semantic tools adapt existing services. Web routes expose scoped registry DTOs and admin commands; the settings panel consumes those DTOs without parsing raw manifests.

The U2 optional-resource builders keep their existing signatures, but U14 replaces their implementation
so only the active `APPROVED + ENABLED` MCP/Skill Head can become an Effective Config binding.
Historical receipts retain their immutable hash; stale, disabled, revoked, signer-revoked, and
hash-substituted selections stay unavailable under stable U2 reason codes.

## Recovery and rollback

READ_ONLY may replay by request hash; IDEMPOTENT_REQUEST requires the same stable remote idempotency key; OUTCOME_STATUS_QUERY reconciles before retry. Unknown effect is absorbing until explicit reconciliation. Feature rollback disables selection/dispatch without deleting immutable revisions used by historical Runs.
