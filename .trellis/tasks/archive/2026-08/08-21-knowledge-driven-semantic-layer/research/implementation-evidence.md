# Implementation Evidence — 2026-08-22

## Current decision

The Markdown evidence → Agent attempt → typed manual fallback → explicit Candidate Revision → creator
self-review/publish → exact Resolved Context path is now verified in an authenticated headed browser and
PostgreSQL. The Agent used the real DeepSeek Provider but stopped without a valid completion, produced no
implicit Revision, and handed control back to the user as designed.

## Acceptance matrix

| AC | State | Current authoritative evidence | Missing proof |
| --- | --- | --- | --- |
| AC1 | VERIFIED | Authenticated browser uploaded `电商交易指标口径 v2` Markdown, local scan/parse/index completed to READY r2, and the document exposed 10 addressable blocks. | PDF/Word/Excel remain intentionally deferred. |
| AC2 | VERIFIED | Immutable document revisions, annotations and usage references are available on the dedicated Knowledge page; the published semantic release retained the exact selected block reference. | None for Markdown MVP. |
| AC3 | VERIFIED | Browser selected Evidence Selection `308b95c3-218f-481b-bd88-e440ee5ef558`; hash `sha256:044db923…de298` was frozen on Candidate Revision and Published Release usage. | None. |
| AC4 | VERIFIED | A real DeepSeek Agent run persisted four Provider turns, failed safely with `SEMANTIC_AGENT_STOPPED_WITHOUT_COMPLETE`, created no Revision, then the typed manual editor continued on the same Candidate. | None. |
| AC5 | VERIFIED | Browser created glossary term `净 GMV`, proposed `NET_GMV_SYNONYM`, and linked it to `成交总额`; ordered ChangeSet regression covers adding a relationship type and its first relationship together. | None. |
| AC6 | IMPLEMENTED AT DETERMINISTIC CORE | Existing Graph v2 reducer/compiler/validator is reused server-side for every save/publish. Semantic package: 17 files / 142 tests passed. 10681/10682 recompile and compare exact digests before persistence/activation. | No new browser display matrix for every stable reason code. |
| AC7 | VERIFIED | Before the explicit click the Candidate had two local edits and zero database Revisions. Clicking `保存草稿 Revision` created only Revision 1 (`7d120257…ecd`) with graph digest `sha256:a9c2e909…5aada`. | None. |
| AC8 | VERIFIED | Creator `b5e7d34f…b160` clicked `审核并发布`, authored the APPROVE decision, closed the review packet, and atomically activated Release `7222a507…d3a1` generation 3. | None. |
| AC9 | VERIFIED | Context Preview bound Release `7222a507…d3a1 · r3`, produced package `sha256:dc6e7151…2f39e0`, and included `TERM: 净 GMV`. Direct projection checks returned 32 metrics, 82 ontology objects and 580 relationships including `NET_GMV_SYNONYM`. | The prior isolated Text2SQL fixture currently needs its workspace-FK setup refreshed; live authenticated Resolved Context proof is green. |
| AC10 | IMPLEMENTED | The same E2E consumes a one-time rollback authorization, restores release generation 1 in the active pointer/runtime activation, then reruns resolution. The rolled-back exact Release has no `metric.net_revenue`, so the authoritative Text2SQL binding fails closed with `PUBLISHED_METRIC_NOT_FOUND` and no stale Candidate SQL is executed. | Browser rollback interaction evidence. |

## Verification log

Passed:

- `pnpm --filter @data-agent/contracts build`
- `pnpm --filter @data-agent/platform build`
- `pnpm --filter @data-agent/research build`
- `pnpm --filter @data-agent/worker typecheck`
- `pnpm --dir apps/web exec tsc --noEmit`
- `pnpm --dir apps/web build`
- Contracts focused Vitest: 2 files / 4 tests
- Web focused Vitest: 3 files / 14 tests
- Worker Markdown parser Vitest: 1 file / 3 tests
- Semantic unit suite: 17 files / 142 tests
- Supabase static migration checks, including exact 10680–10682 renderer checksums
- Fresh PostgreSQL 17 applied 10680–10682 and passed behavioral self-publish, replay, audit,
  evidence-usage, Resolved Context and rollback assertions:
  `KNOWLEDGE_SEMANTIC_RELEASE_ASSERTIONS_PASSED`
- Fresh Text2SQL/PostgreSQL E2E passed with exact release/binding/AST/SQL hashes and real result rows;
  see `research/text2sql-e2e-evidence.json`.
- Headed Chromium (`agent-browser` 0.32.3) proved authenticated Knowledge desktop/mobile empty states,
  workspace navigation, Semantic Studio desktop/mobile preview, filters, three creation entrypoints,
  Candidate actions, responsive inspector layout and keyboard focus. Browser console and page-error
  streams contained no application errors during these page checks.
- `git diff --check`
- Biome on all changed/untracked TypeScript owned by this task
- Real DeepSeek Provider lifecycle: 4 persisted completed turns with observation hashes; the Agent run
  itself failed closed and created no implicit Revision.
- Explicit browser save and creator self-publish: Candidate `99410433…c5c9`, Revision `7d120257…ecd`,
  Release `7222a507…d3a1` generation 3.
- Authenticated Context Preview returned `PARTIAL` (route clarification, not infrastructure failure),
  bound exact release r3 and included `TERM: 净 GMV`; screenshot:
  `evidence/semantic-context-preview-generation-3.png`.
- Typecheck passed for contracts, semantic, agent-runtime, platform, worker and web.
- Focused tests passed: semantic 12, platform job queue 4, Provider lifecycle/store 7,
  contracts 2, agent-runtime 15, web 16 and Markdown parser 3.
- Migration renderers 10683–10699 and the full Supabase static check passed.

Known baseline failures, not treated as green:

- Full PostgreSQL smoke continues past this task's assertion and fails in existing
  `19z-workspace-data-isolation-assertions.sql` with `CONVERSATION_RESOURCES_REQUIRED` because its QA
  message fixture does not freeze Conversation resources.
- Text2SQL unit suite passes 206/207 tests; the existing U5 public-export name guard rejects
  `ontologyPackageValidationIssueSchema` and `semanticOntologyCoverageIssueSchema`. This task does not
  introduce either name. Text2SQL build and typecheck pass after building its self-referential package
  exports.

## Runtime boundaries

- Markdown is the only enabled document format in this MVP.
- File scan and embedding used local deterministic fixtures; the semantic Agent Provider call used the
  real configured DeepSeek API.
- The standalone `knowledge-semantic-release.spec.ts` setup is stale against the newer mandatory
  workspace foreign key and failed before reaching this feature's assertions. This does not replace the
  successful authenticated browser/PostgreSQL Resolved Context proof above.
