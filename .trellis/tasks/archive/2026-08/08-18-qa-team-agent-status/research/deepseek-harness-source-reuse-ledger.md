# DeepSeek Harness Source Reuse Ledger

## Authority

- Upstream checkout: `/Users/lienli/Documents/GitHub/deepseek-harness`
- Fixed commit: `47f943859bef60e4160492346772ded9b24f765a`
- License: MIT
- Copyright: `Copyright (c) 2026 DeepSeek`
- Policy: DeepSeek Harness is the primary code baseline. Prefer copied/adapted implementations over clean-room rewrites
  when Data Agent authority boundaries can be preserved. Retain the MIT notice for copied substantial portions.

## Planned Reuse

| Upstream source | Data Agent target responsibility | Mode | Required adaptation | Evidence |
| --- | --- | --- | --- | --- |
| `packages/client/runtime/src/client/sessions/conversation-assembler.ts` | `PublicRunEvent` keyed activity assembler | ADAPT | replace SessionEvent/definition registry with strict v2 public events | unit + replay property tests |
| `packages/client/ui-conversation/src/client/conversation-nodes/chat-snapshot-builder.ts` | Inline activity snapshot | ADAPT | answer/reasoning/tool/agent/artifact blocks by Run sequence | assembler tests |
| `packages/client/ui-trajectory/src/client/trajectory-snapshot-builder.ts` | Inspector/trajectory shared snapshot ordering | ADAPT | preserve one source array and Data Agent identities | replay equivalence tests |
| `packages/client/ui-conversation/src/client/chat/ReasoningRow.tsx` | Think disclosure row | ADAPT | public summary only, Data Agent token/icon/i18n | component + a11y tests |
| `packages/client/ui-tool/src/client/tool/components/ToolRow.tsx` | Tool/Artifact disclosure rows | ADAPT | strict public payload, one-level children, trajectory/Inspector actions | component tests |
| `packages/client/ui-layout/src/client/AppFrame.tsx` + `columns.ts` + `stores.ts` | desktop Inspector rail, resize and concession | ADAPT | integrate Workspace shell and 640px center floor | layout + browser tests |
| `packages/client/ui-conversation/src/client/skeleton/DetailsPanel.tsx` | QA Inspector material boundary | ADAPT | discriminated Subagent/Artifact target and safe preview | store/component tests |
| `packages/client/runtime/src/client/sessions/session.ts` + `manager.ts` | durable baseline + live Run SSE merge | ADAPT | Last-Event-ID/sequence, no optimistic authority | reconnect tests |
| `packages/client/ui-subagent/src/client/SubagentCatalogAction.tsx` | Subagent overview/live/diagnostic UI | ADAPT | fixed three profiles and one Team depth, no token panel | component/E2E tests |
| `packages/client/ui-deliverables/src/client/ProducedFiles.tsx` | Artifact/file affordance | PARTIAL | retain chip/measurement/a11y; replace `openFile(path)` with Artifact Preview | preview tests |
| Harness details/subagent/replay Web E2E | Data Agent browser proof | ADAPT | real Web + Worker + PostgreSQL SSE | Playwright evidence |

## Implementation Updates

For every target created later, add:

- exact upstream file and commit;
- target file;
- `COPIED`, `ADAPTED`, `PARTIAL`, or `REIMPLEMENTED_WITH_REASON`;
- material differences and removed Harness-only behavior;
- MIT/modified-source notice location;
- validation command and proof artifact.

### Public status event contract — implemented

| Upstream source @ `47f943859bef60e4160492346772ded9b24f765a` | Data Agent target | Mode | Material differences | Validation |
| --- | --- | --- | --- | --- |
| `packages/client/runtime/src/client/sessions/conversation-assembler.ts` | `packages/contracts/src/runs/public-events.ts` | ADAPTED | kept keyed, ordered replay and one public projection; replaced Harness definition registry with strict Zod v1/v2 decode, cursor/terminal page projection and Subagent filtering | `pnpm --filter @data-agent/contracts exec vitest run test/run-public-events.spec.ts` |
| `packages/client/runtime/src/client/sessions/session.ts` + `manager.ts` | Web Run SSE route + `projectPublicRunEventPage` | ADAPTED | kept baseline-then-live cursor semantics; removed local session authority and made PostgreSQL sequence authoritative | contract test + Web typecheck |
| Harness event normalizer and unknown-event refusal pattern | `packages/contracts/src/runs/runtime.ts` + PostgreSQL 10671 validator | REIMPLEMENTED_WITH_REASON | Data Agent requires exact App/Tenant/Environment/Run, Worker fence, immutable ArtifactReference and PostgreSQL trigger enforcement unavailable in Harness | PG17 `47-public-agent-event-assertions.sql` |
| `packages/client/ui-trajectory/src/client/trajectory-snapshot-builder.ts` | `apps/web/src/lib/qa-event-assembler.ts` + resolution trace projector | ADAPTED | preserved one ordered source stream; added strict Agent/Tool/Artifact public identities and retained v1 read compatibility | Web/platform focused tests |

No substantial upstream source block was copied verbatim in this contract slice, so no additional MIT source header is required. The primary Harness attribution remains in this ledger; UI slices will record copied/adapted component-level code separately.

### Production Team runtime — implemented

| Upstream source @ `47f943859bef60e4160492346772ded9b24f765a` | Data Agent target | Mode | Material differences | Validation |
| --- | --- | --- | --- | --- |
| `packages/session/session-persistence/src/coordinator.ts` + `preparations.ts` | `apps/worker/src/teams/production-team-runtime.ts` | ADAPTED | retained prepare-before-dispatch, stable operation identity and replay-first coordination; replaced Harness session backend with PostgreSQL Team Store commands, Worker Fence and deterministic task/handoff/context/completion/acceptance identities | production runtime unit/replay tests + Worker typecheck |
| `packages/session/session-checkpoint-policy/tests/crash-recovery.e2e.ts` | `apps/worker/test/teams/production-team-runtime.spec.ts` | ADAPTED | retained crash/reopen test shape; Data Agent recovery loads accepted Report task and delegates external side effects to existing durable `executeSideEffectOnce` receipts | focused Worker tests |
| `packages/client/runtime/src/client/sessions/session.ts` higher-seq/replay rules | `apps/worker/src/runs/run-execution-context.ts` + production runtime replay | ADAPTED | retained stable logical-call identity and replay no-op semantics; enforced frozen `max_provider_calls`, duplicate logical-call denial and PostgreSQL Provider receipts | `run-effective-config.spec.ts` |
| Harness subagent lifecycle/catalog persistence | Team root/child tasks, Handoffs and public Agent status | REIMPLEMENTED_WITH_REASON | Harness child sessions are independent transport addresses; Data Agent children must instead bind approved Product Profiles, Task Capability, Context Epoch, Artifact scope, Acceptance and Worker Fence | Team Store/runtime tests |
| Harness produced-file/details affordance contract | `product-team-artifact@1.0.0`, PostgreSQL Product Team Artifact Store and existing Preview projector | REIMPLEMENTED_WITH_REASON | Harness opens local files; Data Agent commits content-addressed SQL/TABLE/REPORT projections and only publishes exact committed refs | contracts/platform preview tests |

No substantial upstream source block was copied verbatim in this runtime slice, so no per-file MIT header was added. Control-flow and recovery patterns were adapted while Data Agent domain, PostgreSQL authority and public-event contracts remain project-native.

### Q&A Inline activity and Inspector UI — implemented

Modified-source notice: `apps/web/src/components/qa/DEEPSEEK_HARNESS_MIT_NOTICE.md` retains the full DeepSeek MIT
license and copyright for every UI target below.

| Upstream source @ `47f943859bef60e4160492346772ded9b24f765a` | Data Agent target | Mode | Material differences | Validation |
| --- | --- | --- | --- | --- |
| `runtime/.../conversation-assembler.ts` + `ui-conversation/.../chat-snapshot-builder.ts` | `apps/web/src/lib/qa-event-assembler.ts` | ADAPTED | keyed by strict Run sequence, `block_id`, `call_id`, and exact `profile_id/task_id`; adjacent answer deltas coalesce; Team depth is fixed to one; terminal closure comes from public Run terminal | `qa-event-assembler.spec.ts` replay/order/closure/headless tests |
| `ui-conversation/.../ReasoningRow.tsx` + `ui-tool/.../ToolRow.tsx` | `process-disclosure.tsx` + `conversation-activity-stream.tsx` | ADAPTED | public summary only; sibling disclosure/entity actions; governed ArtifactReference replaces filesystem paths; Data Agent status/error/i18n tokens | `process-disclosure`, `chat-message-activity`, i18n tests |
| `ui-layout/AppFrame.tsx` + `columns.ts` + `stores.ts` | `qa-inspector-layout.ts` + `qa-inspector.tsx` + Q&A page frame | ADAPTED | 640px center floor, 320–520px details, derived auto-collapse without clearing selection, fixed viewport shell, 390px content sheet, browser-local width preference | `qa-inspector-layout.spec.ts` 1280/1000/959 + browser 1440x1000/390x844 geometry proof |
| `ui-conversation/.../DetailsPanel.tsx` + `stores.ts` | `qa-inspector-target.ts` + QA store Inspector state | ADAPTED | strict contract target, URL conversation locator, exact active-conversation Run validation, focus return; material remains replay/Preview-derived | `qa-inspector-target.spec.ts`, `qa-inspector-store.spec.ts` double reload/cross-Run tests |
| `runtime/sessions/session.ts` + `manager.ts` | QA store `attachReplayRunStream` | ADAPTED | replay cursor resumes the same PostgreSQL Run SSE; connection state remains separate from Agent authority; conversation/run generation guard rejects late frames | resumable cursor and cross-conversation frame tests |
| `ui-subagent/SubagentCatalogAction.tsx` | `qa-inspector.tsx` Subagent Overview/Public events/Artifacts | ADAPTED | fixed Semantic/Text2SQL/Report public labels, exact durable task address, one Team level, no token/model/private callback panel | `qa-inspector-component.spec.tsx` ready/stale baseline tests |
| `ui-deliverables/ProducedFiles.tsx` | Tool Artifact chips + existing `ArtifactWorkspace` | PARTIAL | removed host `openFile(path)`; only committed exact ArtifactReference opens authenticated Preview API with explicit stale/denied/hash/unsupported errors | Artifact workspace tests + Inspector component contract |

Codex desktop remains a black-box functional target only; no Codex source or private protocol was copied. Reasonix remains
an architecture-only reference; no Reasonix UI/TUI/Desktop code was copied.
