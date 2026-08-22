# Data Agent Team Operations

## Activation Order

1. Confirm the workspace has approved Model, Context Policy, Execution Safety Policy, Semantic Release, and Schema Snapshot revisions.
2. Materialize the nine built-in Skill revisions with `materializeBuiltinTeamProfiles`. Skill commits must complete before any Product Profile commit.
3. Commit the three Product Profiles as a workspace owner: `governed-text2sql-agent`, `report-writing-agent`, then `semantic-management-agent`.
4. Read `/api/workspaces/{workspaceId}/subagent-capabilities`. Confirm each visible item has the intended immutable Profile revision, discovery descriptor, input/output Artifact types and constraints.
5. Start a Q&A Run. Its command is `START_DATA_AGENT_TEAM`; its v3 Worker lease is `ROOT_HARNESS@1` and carries a frozen catalog snapshot. It must not carry a keyword-derived selected Profile set.

Do not activate a Profile by direct table writes. The Registry RPC revalidates the active Skill Heads, approval state, signer revocation, CAS version, scope, actor, and canonical hashes in one transaction.

## Healthy Run Evidence

A healthy Root Harness Run has all of the following:

- public Root decision-summary blocks with `START`, one selection `DELTA`, and `END` events;
- paired `tool_started` and `tool_completed` or `tool_failed` events for every invoked Tool;
- content-addressed Resolved Context package and receipt refs;
- for delegated turns: frozen Catalog/Profile refs plus Delegation, Team Task, Handoff, Context Epoch, Completion, Verifier, and Acceptance identities;
- for direct turns: no Team Task and an accepted direct-answer verification result;
- accepted specialist Artifact evidence before governed facts reach the final answer.

The SSE stream contains application-owned execution summaries only. `reasoning_content`, raw chain-of-thought, prompts, credentials, Provider bodies, raw context, SQL parameters, and row values are forbidden.

## Failure Codes

`AGENT_PROFILE_SET_NOT_READY` means one or more required Profiles are missing or no longer enabled. Inspect Skill Head lifecycle and signer revocations before recommitting a Profile.

`DATA_AGENT_TEAM_PROFILE_STALE` means the lease refs differ from the current Registry. Do not rewrite the lease. Start a new Run against the current Profile set.

`RUN_DISPLAY_EVENT_REQUIRED` or a Run event persistence error stops execution before an unobservable Agent step. Repair the Run Event Authority and retry under a new valid Attempt/Fence.

`RESOLVED_CONTEXT_REQUIRED` or `RESOLVED_CONTEXT_NOT_RUNNABLE` means the Team did not receive a verified runnable context identity. Do not bypass the resolver or pass raw context directly.

## Three-stage diagnosis

1. **Root decision:** inspect the frozen Catalog hash and the public decision summary. Confirm the provider returned a typed final answer or `delegate_to_subagent@1` candidate. Do not infer the actual route from `question_class` or words in the question.
2. **Host admission:** inspect the selected Product Profile revision, Delegation Receipt, requested/accepted Artifact types and effective capability/budget intersection. A model-selected Profile outside the catalog must fail before a Team Task starts.
3. **Specialist and Artifact:** inspect Tool events, Completion, Verifier and Acceptance. For relationship questions require `semantic.catalog.read`, the frozen Semantic Release and relationship-edge evidence; the trace must not contain a Text2SQL table-count call.

Run `pnpm --filter @data-agent/evals test:unit -- harness-routing-suite` before changing rollout mode. The critical counterexample “我让你回复的是表之间的依赖关系，不是多少张表” must select `semantic-management-agent`, cite relationship graph evidence and contain neither `governed-text2sql-agent` nor a table-count tool.

## Disable And Rollback

Disable the affected Product Profile Head through the Registry command with its current expected version. It disappears from newly frozen Catalogs; existing immutable commands, Profile revisions, Team tasks and receipts remain readable and finish against their frozen identity or fail safely.

Rollout proceeds `SHADOW` → `ENFORCED_INTERNAL` → `ENFORCED_PERCENT` → `ENFORCED_DEFAULT`. Promotion requires all critical routing cases, zero authorization expansion, valid replay/recovery and zero accepted governed facts without matching Artifact evidence.

Rollback changes only the executor used for newly created Runs. Never reinterpret an existing `START_DATA_AGENT_TEAM` lease or replace its frozen executor/catalog mid-Run. v3 Runs continue with `ROOT_HARNESS@1`; older v1/v2 Runs continue their recorded executor until completion or safe failure. The legacy keyword classifier may be used for offline comparison and historical replay only, never as a runtime fallback after a Root provider or admission failure.
