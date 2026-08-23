# U20 Implementation Plan

## Phase 1 - Contracts and assets

- [x] Add strict product Profile/Head/command/result contracts and `AGENT_PROFILE_MANAGE` action.
- [x] Freeze nine built-in Skill, three Prompt/Workflow/Tool manifests and canonical hashes with red tests.
- [x] Extend Run lease/effective config wire with additive `START_DATA_AGENT_TEAM` compatibility tests.

## Phase 2 - PostgreSQL Registry

- [x] Implement Postgres Agent Profile Registry with exact U14 Skill Head validation, actor/RBAC, replay and CAS.
- [x] Add/render 10667 Authority tables/RPC/RLS/grants/postconditions and fresh PostgreSQL 17 assertions.
- [x] Add workspace Agent Profile GET/POST route with server-owned scope/actor/operation identity.

## Phase 3 - Worker product composition

- [x] Implement three profile tool adapters, immutable workflow registry and no-network Mastra composition.
- [x] Implement DataAgentTeamRunner with strict Context/Profile/runtime Acceptance ports; U18 owns the real Falcon Team execution adapter.
- [x] Route new command kind through queue/worker executor registry; preserve explicit legacy Research branch.
- [x] Add stale Profile, role-isolation, visible Tool lifecycle and zero-network denial tests.

## Phase 4 - Trace and finish

- [x] Add durable public reasoning summary events and unified collapsible Tool/reasoning rendering for every Agent conversation.
- [x] Add Profile/Task/Handoff/Verifier/Coverage references to the server-authored Team trace surface.
- [x] Verify desktop/mobile/keyboard/long content without public sensitive fields.
- [x] Run package/full relevant gates, renderer/static/fresh PG17, forbidden scan, Trellis check/spec update.
- [x] Stage only U20 owned paths/hunks, commit, archive, then automatically start U16.

## Guardrails

- No Falcon import/run, real Provider/MCP, billing/credit/price/quota behavior or Claude/Anthropic call.
- No Mastra types in Contracts/Platform/Web public DTOs and no in-memory authority substitution.
- Shared dirty files require exact hunk staging; unrelated workspace/billing/UI work is preserved.
