# U20 Technical Design

## Authority Flow

```text
Built-in Skill bytes -> U14 Skill Registry exact enabled revisions
                           |
U19 runtime profile + U2/U3 model + prompt/workflow/tool/context/verifier hashes
                           |
                 PostgreSQL 10667 Product Profile Registry
                           |
Q&A START_DATA_AGENT_TEAM -> U4 lease/fence -> DataAgentTeamRunner
                           |
U19 Team Store -> Context Compiler -> Mastra execution-only composition
                           |
typed Artifact -> Completion -> Verifier -> Acceptance -> U9 Trace projection
```

## Product Profile Contract

The product revision is separate from the immutable U19 runtime profile. It carries an exact `runtime_profile_ref` plus product
materialization refs/hashes. PostgreSQL does not import `agent-runtime`; Worker composition validates the runtime ref against U19
constants before execution. Only three specialist IDs are registrable. The orchestrator remains a code/version controlled authority.

Every profile binds sorted direct tools and exact Skill refs. Each Skill ref records id/revision/revision hash; 10667 verifies the U14
revision and current Head are exact APPROVED+ENABLED. Profile Head CAS controls READY/disabled state without mutating history.

## Command Compatibility

`effectiveConfigRunLeasePayloadSchema` becomes a discriminated union. Legacy `START_L2_RESEARCH` remains byte-compatible. New
`START_DATA_AGENT_TEAM` adds three exact product profile refs. Run lease command kind and database payload validators accept the new
kind, while Worker dispatch is exhaustive and has no fallback branch. U2 question acceptance emits Team kind for new Greenfield runs.

## Runtime Composition

Worker owns built-in prompt/skill/workflow bytes and computes canonical hashes at startup. Materialization commits U14 Skill revisions
before Profile revisions. `MastraProfileComposition` creates three isolated workflow registrations; each step invokes only injected
domain adapters after U19 direct-tool and TaskCapability checks. Tests use no-network fake domain ports. Provider dispatch remains U3.

`DataAgentTeamRunner` is a `RunWorkflowExecutorPort`. It binds the active lease/effective config/resolved context to a root U19 Team
task, rehydrates PostgreSQL truth, executes the deterministic specialist DAG, and returns COMPLETED only after accepted Report output.
Semantic bootstrap uses the Semantic branch; Q&A uses Text2SQL then Report with at most one evidence-gap repair child.

## Web Projection

`/agent-profiles` uses the workspace authority and Registry only. The Team trace view consumes server DTOs and Artifact references;
it never parses Mastra messages or snapshots. Existing U9 Resolution Trace remains the event/SQL source of truth.

## Public Agent SSE

Every Agent conversation consumes the same `PublicRunEvent` stream. Runtime events use three public-summary events,
`run.reasoning_started`, `run.reasoning_delta`, and `run.reasoning_completed`, correlated by `block_id`. Tool events remain
correlated by `call_id`. The database validates exact payload keys, rejects `reasoning_content`, and advances only the projection
cursor while the Run stays `RUNNING`. Web merges each block/call into one collapsible process row and marks unfinished rows failed or
interrupted when a terminal event arrives.

This aligns with the durable event structure in DeepSeek Harness commit
`47f943859bef60e4160492346772ded9b24f765a` without exposing raw chain-of-thought. All emitted reasoning strings are application-owned,
bounded execution summaries; provider-private reasoning is never accepted into Contracts, PostgreSQL, SSE, or UI.

## Rollback

Disable Profile Heads and route new traffic back only by an explicit deployment/config change. Immutable revisions, Team tasks and
receipts remain readable. Do not rewrite existing `START_DATA_AGENT_TEAM` commands into legacy Research commands.
