# Governed Table + VChart Acceptance Evidence

Date: 2026-08-22 (Asia/Shanghai)

## Isolated vertical

- Web: `http://localhost:3100`
- Worker health port: `9291`
- PostgreSQL 17: isolated `data-agent-u23-chart` container on host port `55433`
- Workspace: `af6be4a9-4695-4c54-b65d-44b9bafe4c9d`
- Conversation: `4f4cda44-f37c-4f10-8cac-784e6bc35787`
- Successful Run: `1e7c2597-28d4-82bc-ac38-b3e26a4e4c1b`
- Planner reason: `DATA_QUERY_TREND_VISUALIZATION`
- Selected Product Profile: `governed-text2sql-agent` only
- Terminal: `COMPLETED`, final public sequence `18`

The isolated database used the repository's full migration chain, the e-commerce demo mart (99,441 `fact_order` rows), and a scoped acceptance workspace. Existing validated base system model-certification receipt authority was copied into this disposable scope as a test fixture because external live certification was not part of this UI task. No fixture or secret is committed to the product tree.

## Exact committed references

| Artifact | Revision | Content hash |
| --- | ---: | --- |
| QueryEvidence | 1 | `sha256:8099ce9b90a80c69226c21dab61f4d634f8bf659522211eb767b56c91b25d290` |
| ArtifactWorkspaceDocument V2 | 1 | `sha256:99b3a01a3c62b9194c680bbb8ba23242ec859eeaa6424a25c588531318f069c3` |
| V2 dataset | - | `sha256:ff603be06ef91a6715efd169d6e0c79c218feda56f58c89efd9d3b93f9e4e742` |

The `sql.sandbox.execute` Tool completion at sequence 13 published both exact references. Text2SQL acceptance still consumed QueryEvidence as the sole `output_ref`; the V2 chart remained a public companion.

## Durable event order

```text
1  run.accepted
2  run.leased
3  run.reasoning_started
4  run.reasoning_delta
5  run.reasoning_delta
6  run.agent_status  governed-text2sql-agent  PENDING
7  run.agent_status  governed-text2sql-agent  RUNNING
8  run.tool_started   semantic.release.read
9  run.tool_completed semantic.release.read
10 run.tool_started   sql.compiler.compile
11 run.tool_completed sql.compiler.compile
12 run.tool_started   sql.sandbox.execute
13 run.tool_completed sql.sandbox.execute  QueryEvidence + ArtifactWorkspaceDocument
14 run.side_effect_committed
15 run.agent_status  governed-text2sql-agent  COMPLETED
16 run.answer_delta
17 run.reasoning_completed
18 run.completed
```

Browser reload reproduced the same activity text/order and exact hashes without duplicate blocks. The Inspector URL retained the exact `run_id`, reference and `anchor_sequence=13` across reload.

## Browser matrix

| Viewport | Inline canvas | Inspector canvas | Document overflow | Composer overlap |
| --- | ---: | ---: | --- | --- |
| 1440x1000 | 1 | 2 total after Inspector opens | `scrollWidth === clientWidth` | none |
| 1024x768 | 1 | 2 total after Inspector opens | `scrollWidth === clientWidth` | none |
| 390x844 | 1 | 2 total after Inspector opens | `390 === 390` | none |

- Native `<summary>` for “查看数据表（与图表同源）” toggled closed with Enter and reopened with Space.
- `prefers-reduced-motion: reduce` was emulated; the chart remained readable, VChart animation is hard-disabled, and no render fallback appeared.
- QueryEvidence table pagination uses native buttons, bounded `offset/limit`, and the exact immutable reference; focused unit coverage proves previous/next enablement.
- Inline and Inspector both resolved the same V2 reference through `ArtifactPreviewPanel` and rendered the same dataset hash.

## Screenshots

- `inline-chart-table-1440x1000.png`
- `inline-chart-table-1024x768.png`
- `inline-chart-table-390x844.png`
- `inspector-chart-1440x1000.png`
- `inspector-chart-1024x768.png`
- `inspector-chart-390x844.png`

## Bundle and validation

- Isolated production `next build`: PASS (50 static pages generated; 6 existing dynamic-filesystem tracing warnings outside this task).
- VChart runtime/error marker was emitted only in dynamic chunk `1sl-7hnwrrhxy.js` (1,624,156 bytes).
- The `/w/[workspaceId]/qa` initial client reference manifest does not list `1sl-7hnwrrhxy.js`; it is loaded only when the dynamic Chart leaf mounts.
- Contracts: typecheck PASS; focused 10/10; full unit 817/817 PASS when run serially.
- Platform: typecheck PASS; focused 19/19; 83 files / 490 tests PASS excluding the pre-existing `postgres-semantic-induction.spec.ts` drift failure unrelated to this task. The public-surface snapshot was updated for the three intentional exports.
- Worker: typecheck PASS; run/credential/indexer unit 74/74; focused Product Team 13/13 PASS.
- Web: typecheck PASS; focused 26/26; full unit 367/367 PASS with 1 existing skipped test.
