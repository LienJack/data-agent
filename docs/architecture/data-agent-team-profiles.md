# Data Agent Root Harness

The Q&A runtime is a model-driven Root Agent harness. PostgreSQL is the lifecycle and authorization authority; Mastra is an execution adapter only. The Root Agent receives a frozen, scope-filtered capability catalog and one generic `delegate_to_subagent@1` tool. It decides from the full conversation whether to answer directly or propose one or more Subagent calls. Production routing does not classify the question with keyword rules.

| Product Profile | Public discovery purpose | Direct tools | Required output |
| --- | --- | --- | --- |
| `semantic-management-agent` | read governed semantic subjects, bindings, formulas and relationship edges | semantic catalog read; candidate write only when separately authorized | `AnalysisReport` or `SemanticGraphCandidate` |
| `governed-text2sql-agent` | compile and execute governed data questions | semantic release read, SQL compile and sandbox execute | `QueryEvidence` |
| `report-writing-agent` | turn accepted evidence into a report | evidence read and report projection | `AnalysisReport` |

Every Product Profile revision is immutable and hash-bound in `agent_profile_revisions`. Its discovery descriptor describes purpose, accepted inputs, output Artifact types and constraints; it is metadata, not an executable prompt and grants no authority. The Host resolves every model proposal against the frozen catalog, intersects run/profile/request budgets and tool allowlists, and persists a delegation receipt before creating the existing Team Task and Handoff. Recursive delegation is rejected.

## Decision and evidence flow

1. Run creation freezes the visible Product Profile revisions into a content-addressed catalog and leases `ROOT_HARNESS@1`.
2. The Root provider returns either a typed final-answer candidate or typed `delegate_to_subagent@1` calls. Failure to select a specialist does not by itself prevent a direct general answer.
3. The Host treats calls as proposals, not authorization. Catalog membership, Artifact compatibility, scope and capability ceilings are revalidated before effects.
4. Admitted specialists execute through the persisted Team runtime. Semantic relationship questions read the exact frozen Semantic Explorer graph; Text2SQL has no generic table-count fallback.
5. Only accepted Artifacts may support governed facts in the Root answer. Direct sections are separately verified as general knowledge or user-provided context.

The former `classifyAgentQuestion` path is retained only as an offline/shadow comparison baseline for old behavior. It is not consulted by Run creation, the Worker executor router, Root admission or specialist execution.

## Context and recovery

The deterministic Context Compiler creates a versioned manifest, coverage report, omission ledger and open-obligation ledger. Its canonical build signature covers the exact selected views and post-policy projection and is limited to 64 KiB. A context epoch replacement progresses through `STARTED`, `SUMMARY_COMMITTED`, `REPLACEMENT_COMMITTED`, `PROBE_PASSED` and `ACTIVATED`. The old epoch remains authoritative until the new epoch proves the same obligation identities and statuses.

Sensitive execution material is never stored in Team tables or public events. PostgreSQL stores only a `SensitiveExecutionArtifact` metadata receipt and lifecycle; encrypted bytes live behind an injected private blob port. Every load and commit appends a narrow audit record.

## Completion and acceptance

Completion does not imply acceptance. A completed output is followed by deterministic verification and a separate acceptance receipt. Acceptance fails closed when context coverage is blocked, obligations remain open, a verifier dimension is not `PASS`, the Artifact cannot be re-resolved under the same scope/Run, or semantic status is not `VERIFIED`.

## Execution boundary

`MastraTeamRuntime` reloads the Task and Context Epoch from Authority immediately before workflow execution and rejects drift. Runtime snapshots are explicitly non-authoritative. Mastra constructors, memory, threads and snapshots are not exported from the package root. Provider dispatch uses the U3 audited invocation path and a raw-free, hash-bound dispatch envelope; U19 introduces no Provider store or billing dependency.

Public activity events expose only the Root decision summary, selected Product Profile revision, specialist Tool status and Artifact acceptance. Prompts, raw provider payloads, credentials and private reasoning are never projected.
