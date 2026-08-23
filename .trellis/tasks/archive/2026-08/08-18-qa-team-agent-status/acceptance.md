# Parent Integration Acceptance

Date: 2026-08-21 (Asia/Shanghai)

## Real vertical run

- Workspace: `908daa22-1bb5-4029-a616-22d0dece1c0b`
- Conversation: `5c7dafae-08cb-4bf0-b5d9-c783e1541503`
- Initial complete proof Run: `93d66234-2613-8e81-b0c2-e8e60228e7b2`
- Controlled reconnect Run: `43e3092d-41cd-810e-9dcb-fa1cc4a0e90e`
- PostgreSQL authority: 28 events, continuous sequence `1..28`, ending in `run.completed`.
- Product artifacts: 2 `AgentDataProjectionReceipt`, 1 `SqlArtifact`, 1 `QueryEvidence`, 1 `AnalysisReport`,
  2 `ProviderResponseArtifact`, and 1 `ProviderTaskArtifact`.
- Final accepted public answer: `当前受治理 E-commerce 数据库共有 14 张已批准业务表。`

The reconnect Run was created while the Worker was stopped. The first browser received sequence 1, then the page was
refreshed. The restored Web adapter requested
`/runs/43e3092d-41cd-810e-9dcb-fa1cc4a0e90e/events/stream?cursor=1`; after the Worker restarted it returned HTTP 200 and
closed at sequence 28. A second refresh deterministically restored the complete activity stream and answer from the same
public Run log.

## Inspector and trajectory

- Consecutive reload twice retained the exact Conversation and Subagent URL target.
- Text2SQL Subagent baseline is addressed by exact `profile_id/task_id`, then merged with the same Run replay cursor.
- Closing an Inspector opened from a trigger returned focus to that exact trigger.
- Inspector width changed from 320px to 344px by keyboard and restored from local storage after reload.
- `run_id + event=7` opens Resolution Trace, scrolls to, expands, and marks the exact Agent event.
- Resolution Trace now accepts both legacy committed L2 documents and strict, hash-verified
  `product-team-artifact@1.0.0` documents. It still fails closed on malformed identity/hash/lineage.
- Exact `SqlArtifact` preview rendered only the safe projection and displayed its content hash.
- A one-character hash mismatch returned `ARTIFACT_INSPECTOR_TARGET_STALE`; no SQL or raw Tool output was shown.

## Browser artifacts

- [Desktop Subagent Inspector](../08-18-qa-team-agent-status-ui/artifacts/desktop-subagent-inspector-1440x1000.png)
- [Desktop Artifact Preview](../08-18-qa-team-agent-status-ui/artifacts/desktop-artifact-preview-1440x1000.png)
- [Desktop trajectory locator](../08-18-qa-team-agent-status-ui/artifacts/desktop-trajectory-locate-1440x1000.png)
- [Mobile Subagent Inspector](../08-18-qa-team-agent-status-ui/artifacts/mobile-subagent-inspector-390x844.png)

Desktop proof used 1440x1000. Mobile proof used 390x844 with reduced motion. The mobile Inspector occupies the content
row above the two-row Composer, the Composer remains actionable, and the document has no horizontal overflow.

## Validation

- Contracts public event tests: 42 passed.
- Worker production team/runtime tests: 75 passed.
- Web unit: 98 files passed, 1 skipped; 352 tests passed, 1 skipped.
- Platform Resolution Trace focused test: 4 passed.
- Contracts, Worker, Web, and Platform typechecks passed in their task slices.
- Scoped Biome for all files owned by the UI/parent integration passed; `git diff --check` passed.
- PostgreSQL migration 10672 ledger/checksum and runtime event validator were verified by the runtime child task.
- Repository-wide `pnpm lint` remains red because unrelated concurrent contract/attribution/API-route files currently
  contain 17 existing Biome errors and 62 warnings. No owned file is among the scoped failures.

## Boundary

DeepSeek Harness commit `47f943859bef60e4160492346772ded9b24f765a` is the primary implementation baseline; the
modified-source MIT notice and source-reuse ledger are committed. Codex desktop is a black-box functional target.
Reasonix contributes only the surface-neutral protocol/layering design. No TUI, Desktop, ACP surface, private Codex
protocol, raw chain-of-thought, arbitrary host file access, or second Run authority was added.
