# U14 Implementation Plan

## Phase 1 - Contracts and RBAC

- [x] Add strict MCP/Tool/Skill revision, lifecycle, effect and receipt contracts with tamper tests.
- [x] Add `EXTENSION_MANAGE` action and role matrix tests.
- [x] Define Effective Config exact revision selection and stale/disabled reason contracts.

## Phase 2 - PostgreSQL registries

- [x] Add migration source/renderer for immutable revisions, heads, signer revocation and effect records.
- [x] Implement narrow MCP/Skill registry adapters and admin/selection/replay tests.
- [x] Run fresh PG17 RLS/owner/grant/CAS/revocation assertions.

## Phase 3 - Runtime and security

- [x] Implement SSRF-safe MCP transport boundary and zero-network rejection matrix.
- [x] Implement effect intent/dispatch/observed/unknown/reconcile lifecycle.
- [x] Adapt five Semantic MCP tools to existing Context/Graph/Text2SQL services.

## Phase 4 - Web and finish

- [x] Add workspace routes and restrained Extensions settings panel with role/state coverage.
- [x] Run package/full scoped tests, builds, Biome, forbidden scans and browser screenshots.
- [x] Run Trellis check/spec update; scoped commit/archive follows after the final staged-diff audit.

## Guardrails

- No arbitrary Skill install scripts or unverified fetched bytes.
- No raw Provider/MCP network in intermediate tests.
- No duplicate Context, Graph, SQL Compiler or Firewall implementation.
- Stage only U14 hunks from shared index/RBAC/composition files.
