# Data Agent Team Operations

## Activation Order

1. Confirm the workspace has approved Model, Context Policy, Execution Safety Policy, Semantic Release, and Schema Snapshot revisions.
2. Materialize the nine built-in Skill revisions with `materializeBuiltinTeamProfiles`. Skill commits must complete before any Product Profile commit.
3. Commit the three Product Profiles as a workspace owner: `governed-text2sql-agent`, `report-writing-agent`, then `semantic-management-agent`.
4. Read `/api/workspaces/{workspaceId}/agent-profiles?enabled_only=true`. The response must contain exactly those three profiles in canonical order.
5. Start a Q&A Run. Its accepted command and Worker lease must both be `START_DATA_AGENT_TEAM` and carry the same three exact Profile refs.

Do not activate a Profile by direct table writes. The Registry RPC revalidates the active Skill Heads, approval state, signer revocation, CAS version, scope, actor, and canonical hashes in one transaction.

## Healthy Run Evidence

A healthy Team Run has all of the following:

- public reasoning-summary blocks with `START`, zero or more `DELTA`, and `END` events;
- paired `tool_started` and `tool_completed` or `tool_failed` events for every invoked Tool;
- content-addressed Resolved Context package and receipt refs;
- Team Task, Handoff, Context Epoch, Completion, Verifier, and Acceptance identities in the Team trace;
- an `ACCEPTED` Report result before the outer Run becomes `COMPLETED`.

The SSE stream contains application-owned execution summaries only. `reasoning_content`, raw chain-of-thought, prompts, credentials, Provider bodies, raw context, SQL parameters, and row values are forbidden.

## Failure Codes

`AGENT_PROFILE_SET_NOT_READY` means one or more required Profiles are missing or no longer enabled. Inspect Skill Head lifecycle and signer revocations before recommitting a Profile.

`DATA_AGENT_TEAM_PROFILE_STALE` means the lease refs differ from the current Registry. Do not rewrite the lease. Start a new Run against the current Profile set.

`RUN_DISPLAY_EVENT_REQUIRED` or a Run event persistence error stops execution before an unobservable Agent step. Repair the Run Event Authority and retry under a new valid Attempt/Fence.

`RESOLVED_CONTEXT_REQUIRED` or `RESOLVED_CONTEXT_NOT_RUNNABLE` means the Team did not receive a verified runnable context identity. Do not bypass the resolver or pass raw context directly.

## Disable And Rollback

Disable the affected Product Profile Head through the Registry command with its current expected version. New Team Runs then fail before acceptance with `AGENT_PROFILE_SET_NOT_READY`; existing immutable commands, Profile revisions, Team tasks, and receipts remain readable.

Rollback to `START_L2_RESEARCH` requires an explicit deployment or routing change. Never reinterpret an existing `START_DATA_AGENT_TEAM` command as legacy Research work.
