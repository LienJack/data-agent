# DataFoundry CoA Quick Start

This runbook covers the governed Greenfield workspace journey. It does not authorize a release, replace an Authority Receipt, or run Falcon.

## Roles

| Role | Responsibility | First surface |
| --- | --- | --- |
| Workspace Admin | Configure a certified model profile, data source, workspace defaults, and bootstrap authorization | `/platform-settings`, `/data-sources` |
| Semantic Agent | Scan the schema, generate a candidate, and run deterministic validation | `/semantic`, `/jobs` |
| Semantic Maintainer | Resolve validation blockers and later drift candidates; review does not imply publish | `/semantic` |
| Analyst | Ask questions and inspect SQL, evidence, report artifacts, public reasoning summaries, tool calls, and Team Trace after v1 is published | `/qa`, `/results` |

All paths above are relative to `/w/:workspaceId`. The URL workspace ID and server capability projection are authoritative; browser storage is not.

## Initial Release

1. In **Data sources**, create one governed connection. Network adapters require a scoped `SecretRef`; SQLite and DuckDB use allowlisted file identity.
2. Run Schema Scan and wait for a durable Job terminal state. A UI `completed` state does not mean semantic evidence is accepted.
3. In **Platform settings**, select a certified model profile and complete Workspace Defaults. Do not paste credentials into prompts or connection fields.
4. In **Semantic governance**, start the bootstrap task. The public event stream may show safe reasoning summaries and tool boundaries, but never private chain-of-thought, raw context, system prompts, or secrets.
5. Inspect Candidate, validation issues, mappings, joins, formulas, provenance, and Context Preview. `VALIDATION_FAILED`, `POLICY_MISSING`, and `POLICY_EXPIRED` are different blockers.
6. Only the Bootstrap Authority can publish generation 1 under `SYSTEM_BOOTSTRAP_POLICY`. `READY_FOR_REVIEW` still blocks QA and Falcon.
7. Continue only when the state is `PUBLISHED_V1_READY` and the active Release Set hash matches the published receipt.

## Agent Conversation

In **Agent chat**, select the effective data source/model profile and submit a business question. Public Run SSE reconstructs the answer and process after reconnect:

- reasoning is a safe public summary grouped by `block_id` and collapsed by default;
- tool input/result boundaries are grouped by `call_id` and collapsed by default;
- expanded details contain only public projections;
- Team Trace exposes Profile, Workflow, Skill, Tool, Task, Handoff, Epoch, and Verifier identities;
- Context Preview exposes route, published release, schema snapshot, capacity, and evidence summaries.

Use keyboard focus on each disclosure button or native summary to expand it. A missing or invalid public event is an explicit error, not an empty successful state.

## Recovery Matrix

| Reason | Only valid recovery |
| --- | --- |
| `PERMISSION_DENIED` | Request access or contact the Workspace Admin; no Retry |
| `NOT_READY` | Open the missing dependency |
| `STALE_RELEASE` | Preview again and create a new Task |
| `CHECKPOINT_AVAILABLE` | Resume from the named checkpoint |
| `PROVIDER_UNAVAILABLE` | Select a certified profile and create a new Attempt |
| `THROTTLED` | Wait for Retry-After / automatic backoff |
| `EXECUTION_LIMIT_REACHED` | View partial artifacts or narrow scope and create a new Run; no Resume under the same immutable limit |
| `TERMINAL_POLICY_DENIAL` | Read the denial; no Retry |
| `OUTCOME_UNKNOWN` | Reconcile only; never ordinary Retry |

## State Axes

Keep these axes independent:

- Task: `QUEUED / RUNNING / COMPLETED / FAILED / ...`
- Evidence: `CANDIDATE / VALIDATED / ACCEPTED / PUBLISHED`
- Benchmark: `DEMO / TUNING / HOLDOUT / TEST_UNSCORED`
- Release: `HOLD / GO`

Therefore `completed != accepted`, `PASS != GO`, and official TEST means `submission complete, unscored`.

## U17 Verification

U17 uses deterministic tests and authenticated local browser checks only. It verifies Chinese/English state continuity, Context Preview states, public SSE disclosures, Team Trace redaction, Greenfield guidance, recovery actions, desktop/mobile layout, keyboard access, and private-data exclusion.

The resulting `WorkspaceJourneyEvidenceArtifact` is content addressed and requires every checkpoint to pass. It is Goal/CI evidence, not a product Authority Receipt.

## U18 Boundary

Falcon is imported and executed only in U18, after this Journey Evidence verifies. U18 must run all 28 databases and all 500 cases through the Agent Team and governed runtime. Falcon quality cannot substitute for the Workspace journey, and the Workspace journey cannot substitute for Falcon.
