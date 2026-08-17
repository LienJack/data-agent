# U16 Implementation Plan

## Phase 1 - Contracts and preflight

- [x] Add Adapter descriptor/capability/certification contracts and frozen five-adapter registry.
- [x] Add dialect/adapter binding to execution contracts without weakening existing PostgreSQL invariants.
- [x] Pin and verify required driver/parser dependencies and license/runtime compatibility.

## Phase 2 - Platform adapters

- [x] Add canonical Adapter Registry and readiness derivation.
- [x] Implement five isolated parser/firewall/explain/read-only adapters with injected I/O boundaries.
- [x] Add certification fixtures for write/multi-statement/timeout/row-byte/secret/path/SSRF denial.

## Phase 3 - Gallery

- [x] Replace Web-local database registry with Contracts descriptors; remove Trino and add DuckDB.
- [x] Build dynamic Gallery/connection form states and capability-level selection rules.
- [x] Keep Workspace Datasource API authoritative and expose stable BLOCKED/error states.

## Phase 4 - Finish

- [x] Run focused/full relevant tests, types/build, Biome, isolated adapter smoke and Trellis check/spec update.
- [x] Verify desktop/mobile/keyboard/long content in browser.
- [x] Stage only U16 paths/hunks, commit, archive, then automatically start U17.

## Guardrails

- No Falcon, real Provider, real production Secret, Trino activation, second Datasource Authority, or best-effort dialect fallback.
- Connection and Schema Scan do not imply Governed Query readiness.
- Shared dirty files require exact hunk staging.
