---
title: "U8 Web Frontend SSE Completion"
status: active
created: 2026-08-04
origin: .trellis/tasks/07-25-data-agent-reset-refactor/implement.md (§U8)
depth: standard
---

# U8 Web Frontend: SSE API Client, Cancel/Resume/Replay, Connection Integration

## Summary

Complete the U8 web frontend by adding the SSE streaming API client, Cancel/Resume/Replay controls, and connection-state integration into the existing Zustand workbench store. The app already has all UI components (AuthorityStatusBar, QueryInputSection, ReportSection, HypothesisSection, EvalSection, ClarificationDialog) and a demo state. This plan adds the data layer and interactive controls.

## Problem Frame

The current web app (`apps/web/src/`) hydrates a static M1 demo state on mount. It has no API client, no SSE streaming, no connection recovery, and no way to cancel/resume/replay a run. The implement.md §U8 requires:
- U8.4: Clarification, Cancel, Resume, Replay
- U8.10: SSE recovery from PostgreSQL Projection Version

## Scope Boundaries

**In scope:**
- SSE streaming API client with cursor-based recovery
- Connection state management (idle/connecting/live/reconnecting/closed)
- Cancel/Resume/Replay controls in the UI
- Auto-connect on active run, auto-reconnect with exponential backoff
- Quality checks (typecheck, lint)

**Out of scope (U8-F9 / deferred):**
- U8.12–14: CapabilityDirectory, Eligibility, ProfileRequest (not yet authorized)
- PlatformShell / workspace selection gate (keep M1 page standalone)
- F9 attribution UI
- Published F9 Trace

## Key Technical Decisions

1. **Zustand over useReducer.** The existing store already uses Zustand. The API client exposes functions that return data; the page component calls Zustand actions to merge results. No useReducer in the application layer. (Reference: text2sql's `analysis-api-client.ts` uses useReducer; we adapt the API client pattern but use Zustand for state.)

2. **Connection state as discriminant union.** Add `RunConnectionState` type to `run-projection.ts` and `connection` field to the store. This matches the `ViewState` discriminant union pattern from `.trellis/spec/frontend/type-safety.md`.

3. **SSE recovery via Projection Version.** The API client sends a `cursor` (last known Projection Version) on reconnect. The server replays events from that cursor. No Redis dependency.

4. **API client as a separate module.** `lib/api-client.ts` is a pure function module (fetch + SSE parse). It does not import Zustand. The page component wires events to the store.

## Implementation Units

### U1. API Client (`lib/api-client.ts`)

**Goal:** Create the SSE streaming client with cursor-based recovery, command API, and workspace context resolution.

**Requirements:** U8.4, U8.10

**Dependencies:** None

**Files:**
- Create: `apps/web/src/lib/api-client.ts`

**Approach:**
- Reference text2sql's `analysis-api-client.ts` for SSE patterns
- Adapt to the data-agent's `RunProjection` type instead of `AnalysisTaskReadModel`
- SSE streaming with `cursor` parameter for PostgreSQL Projection Version recovery
- Command API: `createRun`, `commandRun` (start/pause/resume/cancel), `getRun`, `streamRunEvents`
- Auth headers: `x-user-id`, `x-workspace-id` (dev-mode env vars)
- Connection state type exported for the store to consume
- Exponential backoff retry logic as a reusable utility
- Workspace ID resolution (sessionStorage, query param, env var fallback)

**Patterns to follow:**
- `text2sql/apps/frontend/src/lib/analysis-api-client.ts` — SSE streaming, cursor-based recovery, command API shape
- `apps/web/src/lib/run-projection.ts` — existing `RunProjection` type

**Test scenarios:**
- Happy path: SSE stream delivers events in order, cursor advances correctly
- Edge case: empty event stream (no events after cursor)
- Error path: server returns non-200, connection drops mid-stream
- Integration: `mergeRunEvents` deduplicates by sequence, handles conflicts

**Verification:**
- `pnpm typecheck` and `pnpm lint` pass in `apps/web/`

---

### U2. Store Changes (`lib/workbench-store.ts` + `lib/run-projection.ts`)

**Goal:** Add connection state, SSE integration actions, and Cancel/Resume/Replay actions to the Zustand store.

**Requirements:** U8.4, U8.10

**Dependencies:** U1

**Files:**
- Modify: `apps/web/src/lib/run-projection.ts` — add `RunConnectionState` type, add `commands` to `WorkbenchState`
- Modify: `apps/web/src/lib/workbench-store.ts` — add connection state, SSE actions, command actions

**Approach:**
- Add `RunConnectionState` discriminant union: `"idle" | "connecting" | "live" | "reconnecting" | "closed"`
- Add `connection` field to `WorkbenchState` (default: `"idle"`)
- Add store actions: `setConnection`, `setRunControlsVisible`, `setRunId`
- Export new selector hooks: `useRunConnection`, `useRunControls`

**Patterns to follow:**
- Existing `workbench-store.ts` — Zustand `create` + `set` pattern
- existing `run-projection.ts` — `WorkbenchState` interface

**Test scenarios:**
- Happy path: connection state transitions correctly (idle → connecting → live → closed)
- Edge case: state resets on `reset()`
- Integration: connection state accessible via selectors

**Verification:**
- `pnpm typecheck` and `pnpm lint` pass

---

### U3. Page Integration (`app/page.tsx`)

**Goal:** Wire SSE streaming into the page component, add Cancel/Resume/Replay controls, manage connection lifecycle.

**Requirements:** U8.4, U8.10

**Dependencies:** U1, U2

**Files:**
- Modify: `apps/web/src/app/page.tsx` — add SSE integration, add Cancel/Resume/Replay buttons
- Modify: `apps/web/src/components/query-input-section.tsx` — add Cancel/Resume/Replay buttons to the query section

**Approach:**
- In `page.tsx`, add a `useEffect` that:
  - On mount, if a run ID is stored, calls `getRun()` to hydrate
  - If the run is active (non-terminal), starts SSE streaming via `streamRunEvents`
  - On unmount or run change, aborts the SSE connection
  - On SSE events, calls `mergeRunEvents` and updates the store via Zustand actions
  - On disconnect, reconnects with exponential backoff + cursor recovery
- In `query-input-section.tsx`, add Cancel/Resume/Replay buttons below the input area, visible only when a run is active

**Patterns to follow:**
- `text2sql/apps/frontend/src/components/analysis/analysis-workspace.tsx` — SSE lifecycle, connection management, command dispatch
- Existing `page.tsx` — component composition pattern

**Test scenarios:**
- Happy path: SSE connects, events arrive, projection updates, terminal state closes connection
- Edge case: connection drops, reconnects with cursor, catches up on missed events
- Error path: server unavailable, shows error state, retries with backoff
- Integration: Cancel button stops the run, Resume restarts it, Replay re-runs from scratch

**Verification:**
- `pnpm typecheck` and `pnpm lint` pass

---

### U4. Quality Checks

**Goal:** Ensure the web app compiles, type-checks, and lints cleanly.

**Dependencies:** U1, U2, U3

**Files:**
- None (run commands only)

**Approach:**
- Run `pnpm typecheck` in `apps/web/`
- Run `pnpm lint` in `apps/web/`
- Fix any issues found

**Verification:**
- Both commands exit with code 0

---

### U5. Commit

**Goal:** Commit the web app code to the branch.

**Dependencies:** U4

**Approach:**
- Stage all `apps/web/` files
- Create a commit with a descriptive message
- Follow the project's commit style (from `git log --oneline -5`)

---

## System-Wide Impact

- **Interaction graph:** The page component gains a `useEffect` for SSE lifecycle. No new middleware or callbacks.
- **Error propagation:** SSE errors are caught in the page component and set via `setError` on the store. The existing `error` state in `WorkbenchState` is used.
- **State lifecycle risks:** The SSE `AbortController` is cleaned up on unmount. No partial-write or cache concerns.
- **API surface parity:** The API client is a new module; no existing APIs are changed.
- **Unchanged invariants:** Existing components (ReportSection, HypothesisSection, EvalSection, etc.) are not modified. The demo state still works by calling `hydrate(createM1DemoState())`.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Server-side SSE endpoint not yet available | API client is designed to be testable with mock data; the demo state continues to work independently |
| Type mismatches between API client and RunProjection | Both use the same `RunProjection` type from `run-projection.ts` |
| Connection state complexity | Use discriminant union with clear transitions; export selectors for components |

## Sources & References

- **Origin document:** `.trellis/tasks/07-25-data-agent-reset-refactor/implement.md` (§U8 items 4, 10)
- **Reference implementation:** `text2sql/apps/frontend/src/lib/analysis-api-client.ts`
- **Reference component:** `text2sql/apps/frontend/src/components/analysis/analysis-workspace.tsx`
- **Existing store:** `apps/web/src/lib/workbench-store.ts`
- **Existing types:** `apps/web/src/lib/run-projection.ts`
