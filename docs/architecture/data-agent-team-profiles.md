# Data Agent Team v2

U19 defines a fixed, auditable four-profile team. PostgreSQL is the lifecycle and authorization authority; Mastra is an execution adapter only.

| Profile | Direct tools | Delegation | Required output |
| --- | --- | --- | --- |
| `data-agent-orchestrator` | none | the three specialist profiles, depth 1 only | `ReportManifest` |
| `semantic-management-agent` | semantic catalog read and candidate write | none | `SemanticGraphCandidate` |
| `governed-text2sql-agent` | semantic release read, SQL compile and sandbox execute | none | `QueryEvidence` |
| `report-writing-agent` | evidence read and report projection | none | `AnalysisReport` |

Every profile revision is immutable and hash-bound in `agent_profile_revisions`. A Team Task binds the existing U4 active Run attempt, outbox, command and worker fence; U19 does not add another queue. A persisted, short-lived `TaskCapabilityReceipt` is required before handoff, completion or tool use. Child tasks receive only an explicit artifact subset and tighter or equal resource bounds. Recursive delegation is rejected.

## Context and recovery

The deterministic Context Compiler creates a versioned manifest, coverage report, omission ledger and open-obligation ledger. Its canonical build signature covers the exact selected views and post-policy projection and is limited to 64 KiB. A context epoch replacement progresses through `STARTED`, `SUMMARY_COMMITTED`, `REPLACEMENT_COMMITTED`, `PROBE_PASSED` and `ACTIVATED`. The old epoch remains authoritative until the new epoch proves the same obligation identities and statuses.

Sensitive execution material is never stored in Team tables or public events. PostgreSQL stores only a `SensitiveExecutionArtifact` metadata receipt and lifecycle; encrypted bytes live behind an injected private blob port. Every load and commit appends a narrow audit record.

## Completion and acceptance

Completion does not imply acceptance. A completed output is followed by a deterministic seven-dimension verifier decision and a separate acceptance receipt. Acceptance fails closed when context coverage is blocked, obligations remain open, any verifier dimension is not `PASS`, or semantic status is not `VERIFIED`.

## Execution boundary

`MastraTeamRuntime` reloads the Task and Context Epoch from Authority immediately before workflow execution and rejects drift. Runtime snapshots are explicitly non-authoritative. Mastra constructors, memory, threads and snapshots are not exported from the package root. Provider dispatch uses the U3 audited invocation path and a raw-free, hash-bound dispatch envelope; U19 introduces no Provider store or billing dependency.

Falcon import, scoring and smoke are not part of U19. Falcon remains the final U1–U20 acceptance gate.
