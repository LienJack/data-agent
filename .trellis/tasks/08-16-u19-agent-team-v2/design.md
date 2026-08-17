# U19 Technical Design

## Authority Flow

```text
U4 active RunWorkLease + U2 Context/EffectiveConfig + committed Artifact refs
                                |
                     PostgreSQL 10658 Team Task
                                |
             TaskCapability + AgentProfileRevision
                                |
        deterministic Context Compiler / Context Epoch
                                |
            Mastra execution-only profile workflow
                                |
 final ProviderDispatchEnvelope == manifest/projection/U3 ceilings
                                |
                 U3 audited provider invocation
                                |
 typed output -> completion -> verifier -> acceptance
```

PostgreSQL owns Task/Attempt/Revision/Event/Handoff/Epoch/Obligation/Completion/Acceptance. Mastra owns only execution mechanics and an
`EXECUTION_SNAPSHOT_ONLY` checkpoint. Rehydration always starts from PostgreSQL records and committed Artifact references.

## Versioned Profiles

Team v2 uses four identities:

- `data-agent-orchestrator`: no domain direct tools; may request depth-1 delegation within a fixed ceiling.
- `semantic-management-agent`: semantic read/authoring candidate tools; no SQL execution or report acceptance.
- `governed-text2sql-agent`: published semantic/context/compiler/sandbox tools; no semantic mutation or report publication.
- `report-writing-agent`: evidence resolver and deterministic report projection; no datasource access or semantic mutation.

`AgentProfileRevision` contains a canonical revision hash over profile id/revision, direct tool allowlist, delegation ceiling,
mandatory context kinds, workflow id/revision, expected output artifact kinds and verifier contract. Profile definitions are immutable
constants; runtime selection carries the full exact revision reference.

## Task and Capability

The v2 Task record binds full scope, run, parent lineage, depth, profile revision, goal/task revision, active attempt/fence, artifact
allowlist, context limits, execution limits and acceptance contract. Root orchestration depth is 0; only the orchestrator may create
depth-1 children. A child has no delegation ceiling.

`TaskCapability` is a short-lived signed claim whose persisted receipt binds issuer/key-id/audience, task/attempt/fence,
profile revision, artifact identities, operation audiences, expiry, nonce and revocation version. Runtime code can parse candidates,
but only a persisted resolver/brand makes a capability authoritative. The signing secret never enters a task, manifest, receipt or log.

## Context Compiler and Epochs

The compiler input is a strict truth snapshot: goal/task revision, event watermark, policy and semantic release refs, committed artifact
refs, profile revision and open obligations. It deterministically sorts and slices untrusted fragments, then emits:

- `ContextBuildManifest`: exact truth/ref/version inputs and capacity ceilings;
- `ProjectionCoverageReceipt`: candidate set, included set, omitted set and on-demand refs;
- `OmissionLedger`: deterministic reason for every omitted candidate;
- `ContextEpoch`: active model-view artifact ref plus build signature;
- `OpenObligationLedger`: non-model truth for unresolved constraints/effects/claims/child commitments/acceptance clauses.

Compaction creates a proposed epoch in phases `STARTED/SUMMARIZED/REPLACED/PROBED`. PostgreSQL activates it only when the new
obligation ledger is set-equivalent to the current ledger and all referenced artifacts are committed. Until activation, the prior
epoch remains current. Pending/unknown effects force reconciliation before replacement.

## Dispatch Boundary

After all Mastra processors/middleware, the adapter normalizes the final messages, tool schemas and attachments into hashes and builds
a `ProviderDispatchEnvelope` containing profile/model revision, context epoch/build signature, U3 projection ref, effective input/output
ceilings and trusted token upper bound. The transport compares this envelope to the compiler manifest and U3 projection before opening
the network. Any mutation, drift, secret scan failure or capacity mismatch yields a stable local error and zero provider calls.

The Team store never persists raw prompts/messages/responses/tool args/headers or credential material. It stores hashes, exact refs,
bounded enums and redacted telemetry only.

## Handoff, Completion and Acceptance

`prepareTeamHandoffV2` validates:

- parent is the orchestrator at depth 0;
- child profile is within delegation ceiling;
- exact scope/run/profile revision and artifact subset;
- strictly narrower context/execution bounds;
- active parent revision/attempt/fence and unexpired capability;
- fresh child identity and no recursive delegation.

The PostgreSQL prepare RPC locks parent Task/Attempt/RunWorkLease and performs expected-revision CAS. Replay of the same request hash
returns the same receipt; altered requests conflict. Child results are collected only while the parent lineage/fence/revision remains
current. Late results append an audit event but cannot update the accepted result set.

Completion commits only a typed output document/ref. A separate verifier creates a seven-dimensional `VerifierDecision`. Acceptance
requires exact task revision, completion hash, verifier hash, mandatory context coverage and no blocking obligations. Business
acceptance is therefore never inferred from Agent completion or Mastra workflow success.

## Sensitive Execution Artifacts

`SensitiveExecutionArtifact` documents are content-addressed encrypted blobs. The injected private blob port receives ciphertext only;
PostgreSQL metadata stores plaintext/ciphertext hashes, key id, scope/task/epoch, lifecycle, TTL/legal hold/refcount/tombstone/backup
expiry and access audit. Reads require AppCapability + TaskCapability + exact reference and return through a decrypting resolver. There
is no public preview or browser DML grant.

## PostgreSQL 10658

10658 adds only the Team authority tables needed by the vertical slice. U4 remains the attempt/queue authority, and obligation ledgers are hash-covered inside immutable context-epoch transition rows rather than duplicated into another table:

- `agent_team_tasks`, bound to existing U4 `run_attempts`;
- `agent_team_handoffs`;
- `agent_team_events`, including immutable ignored-late-result audit records;
- `agent_team_context_epochs` with embedded current/proposed obligation ledgers;
- `agent_team_task_capabilities`, `agent_team_verifier_decisions`;
- `agent_team_completion_receipts`, `agent_team_acceptance_receipts`;
- `sensitive_execution_artifacts`, `sensitive_execution_artifact_access_audit`.

All rows carry app/tenant/environment/run and owner principal. Team attempts bind existing U4 `run_attempts`, outbox, lease token and
fence rather than creating another queue. RPCs are narrow SECURITY DEFINER functions with empty search path, explicit scope predicates,
FORCE RLS, NOLOGIN owners and no application-role direct DML:

- `create_agent_team_task`
- `prepare_agent_team_handoff`
- `issue_agent_team_task_capability`
- `load_agent_team_task_capability`
- `commit_agent_team_context_epoch`
- `commit_agent_team_completion`
- `commit_agent_team_acceptance`
- `record_agent_team_late_result`
- `load_agent_team_run`
- `commit_sensitive_execution_artifact`
- `load_sensitive_execution_artifact`

Every public JSON document/hash uses the Contracts canonical SHA-256 wire and the database `u2_canonical_sha256` implementation.

## Early Slice and Recovery

The early slice uses deterministic fake/no-network profile executors over real Team store records and committed Artifact refs:

1. Orchestrator delegates Text2SQL; verifier accepts a typed evidence artifact; Report receives only accepted evidence refs.
2. Orchestrator delegates Semantic; output remains Candidate and cannot satisfy published-evidence acceptance.
3. Kill points around context epoch and handoff writes replay from PostgreSQL with exact revision/fence semantics.

This proves runtime and authority mechanics only. U20 later wires the complete domain tools and UI.
