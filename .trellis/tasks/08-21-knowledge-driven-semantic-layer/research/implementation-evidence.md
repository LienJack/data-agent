# Implementation Evidence — 2026-08-22

## Current decision

Task remains `in_progress` only because browser interaction evidence is pending. The governed Markdown
evidence → Semantic Candidate → self-publish → exact Resolved Context → Text2SQL → PostgreSQL execution
and rollback path now has a fresh PostgreSQL 17 behavioral proof.

## Acceptance matrix

| AC | State | Current authoritative evidence | Missing proof |
| --- | --- | --- | --- |
| AC1 | IMPLEMENTED, BROWSER PARTIAL | `KnowledgeDocumentRevision`/block contracts, deterministic Markdown parser, 10673 authority, Knowledge workspace routes/page. Parser tests cover Chinese UTF-8, CRLF/NFC, blocks, empty/oversize/fence failures. Headed browser proved authenticated Knowledge desktop/mobile navigation, loading and empty states. | Upload → scan → parse/index → block browsing is HOLD because the local environment has no configured Knowledge Embedding provider or `READY` Embedding Profile. |
| AC2 | IMPLEMENTED, BROWSER PENDING | 10673 immutable revisions, annotations and usage references; Knowledge routes expose revisions/annotations/usage; revision commit has no Candidate side effect. | Browser proof for annotation/version usage and advisory impact presentation. |
| AC3 | IMPLEMENTED | Exact Evidence Selection freezes ordered block refs/hashes. Semantic authoring service loads only that authorized selection and rejects expansion/oversize input. Route tests and PostgreSQL assertions pass. | Browser interaction evidence. |
| AC4 | IMPLEMENTED, BROWSER PARTIAL | Agent authoring, evidence-bound Agent authoring and manual typed edits converge on Graph v2 operations. 10674 persists only explicit save as Candidate Revision; save route tests prove no Revision before the route call. Headed desktop/mobile preview proved the three entrypoints and unified Candidate action area. | A real browser candidate cannot be created in the current workspace until it has an Active Graph v2. |
| AC5 | IMPLEMENTED, BROWSER PARTIAL | Direct editor filters registry entries to `AGENT_AUTHORED`, renders typed endpoint/attribute forms, supports update/reconnect/retire, and locks physical nodes/edges. A separate typed `ADD_EDGE_TYPE` proposal flow creates only Candidate operations and rejects physical fact attributes. Unsaved operations are projected locally, so a newly added Node/Edge Type can be used by a later operation and repeated edits advance versions in order. Graph reducer continues to reject system-managed mutation. | Real browser mutation remains HOLD on the current workspace's missing Active Graph v2; representative desktop/mobile read projections are visually verified. |
| AC6 | IMPLEMENTED AT DETERMINISTIC CORE | Existing Graph v2 reducer/compiler/validator is reused server-side for every save/publish. Semantic package: 17 files / 142 tests passed. 10674/10675 recompile and compare exact digests before persistence/activation. | No new browser display matrix for every stable reason code. |
| AC7 | IMPLEMENTED | Agent completion only becomes `READY_TO_SAVE`; explicit save CAS creates Source/Candidate Revision. Web uses dirty state and `beforeunload`; self-publish requires the exact last saved revision. `get_saved_semantic_candidate_revision` restores the exact principal/domain/run-bound saved Revision after refresh; the fresh PostgreSQL assertion covers this restore path. Focused route tests pass. | Browser leave-warning and refresh-restore interaction require an Active Graph v2 workspace. |
| AC8 | IMPLEMENTED | 10675 owner-only creator self-review/publish RPC, exact revision/hash checks, separate review and publish facts/audit rows, atomic activation, idempotency. Fresh PostgreSQL 17 assertion emitted `KNOWLEDGE_SEMANTIC_RELEASE_ASSERTIONS_PASSED`. | Browser button proof. |
| AC9 | IMPLEMENTED | Fresh PostgreSQL 17 E2E freezes exact Knowledge Evidence Selection `00000000-0000-4000-8000-000000006796`, publishes generation 2, builds an authoritative Resolved Context binding, compiles a real PostgreSQL AST/SQL artifact and executes it. Results are enterprise=150 and smb=30. Exact hashes are retained in `text2sql-e2e-evidence.json`. | Browser interaction evidence for the user-facing path. |
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
- Supabase static migration checks, including exact 10673–10675 renderer checksums
- Fresh PostgreSQL 17 applied 10673–10675 and passed behavioral self-publish, replay, audit,
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

Known baseline failures, not treated as green:

- Full PostgreSQL smoke continues past this task's assertion and fails in existing
  `19z-workspace-data-isolation-assertions.sql` with `CONVERSATION_RESOURCES_REQUIRED` because its QA
  message fixture does not freeze Conversation resources.
- Text2SQL unit suite passes 206/207 tests; the existing U5 public-export name guard rejects
  `ontologyPackageValidationIssueSchema` and `semanticOntologyCoverageIssueSchema`. This task does not
  introduce either name. Text2SQL build and typecheck pass after building its self-referential package
  exports.

## Runtime proof still required

1. Configure `DATA_AGENT_KNOWLEDGE_EMBEDDING_PROVIDER`, model, HTTPS base URL and API key, then
   register a matching `READY` Embedding Profile for the workspace.
2. Bootstrap or publish an Active Graph v2 for the browser-test workspace without replacing a user's
   existing release.
3. Run the user-facing Markdown upload/selection → Candidate save/refresh restore → self-publish flow
   in the browser. The PostgreSQL/Text2SQL authority path is already green; this remaining item is UI
   interaction evidence, not a backend correctness gap.
