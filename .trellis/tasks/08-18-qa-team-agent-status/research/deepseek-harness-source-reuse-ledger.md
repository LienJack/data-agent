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
