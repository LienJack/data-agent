# U8 Implementation Plan

## Phase 1 - Contracts and reducer

- [x] Add strict interruption/reply/branch commands, receipts, canonical hashes and public DTOs.
- [x] Version suspension events without breaking historical Runtime Event replay.
- [x] Cover scope/version/fence/actor/hash substitution and terminal projection transitions.

## Phase 2 - PostgreSQL and Platform

- [x] Add 10666 source/renderer for interruptions, replies, branches, receipts, owner/RLS/grants.
- [x] Implement atomic Reply+Resume and reference-only Branch RPCs with replay/CAS/stale checks.
- [x] Add `createPostgresSessionRecovery` correlation checks and focused tests.
- [x] Run fresh PostgreSQL 17 assertions for row closure, non-copying branch and no duplicate resume/effect.

## Phase 3 - Routes and recovery UX

- [x] Add workspace-scoped Branch and Interruption GET/POST routes with server-owned identities.
- [x] Wire ClarificationDialog to durable OPEN interruption and exact Reply command.
- [x] Characterize Q&A event assembly/reload for WAITING, failed/cancelled and interruption states.
- [x] Verify admin/analyst/viewer permissions and desktop/mobile/focus/ARIA behavior in browser.

## Phase 4 - Finish

- [x] Run Contracts/Platform/Web focused and full relevant tests, typecheck/build and Biome.
- [x] Run 10666 renderer/static/fresh PG17; scan for raw prompt/context/secret/history-copy fields.
- [x] Run Trellis check/spec update; scoped commit/archive follows the staged-diff audit, then activate U9.

## Rollback points

- Event compatibility failure: keep legacy suspension variant and remove only new writer path.
- Reply atomicity failure: revoke Reply RPC rather than split interruption and Resume transactions.
- Branch closure failure: keep Branch route disabled; never fall back to copying parent messages.
