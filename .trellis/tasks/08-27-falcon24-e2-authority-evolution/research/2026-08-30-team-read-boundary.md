# Team read-side boundary

## Observed failure

Build `8921c4cf`, Run `179081c9-a6ae-8dc1-b51e-b51d91383c60`: business/QA pass, Team API returns null and Profile API returns an empty V1 list. No formal PASS was recorded.

## Profile correction

- Current runtime publishes V2 revisions; default list RPC filters V1. Trace now explicitly requests list-result V2 through the existing READ-only `listDiscoverable` port. Existing default/V1 GET and POST are unchanged.
- Client verifies V2 Revision hashes; card renderer can display either historical V1 fixture or current V2 without inventing historical names. Three new tests first failed on V1 response/unsupported version/client parser; focused route/client/Team/Trace tests and Web typecheck passed after the fix.

## Team repair diagnosis

- Direct read-only scratch audit found four `agent_team_tasks`, including two Root tasks and two accepted Specialist tasks. These are the SAME existing tables used by the public RPC, not a missing new Product Team table.
- `load_agent_team_public_projection` and `_v2` both run as `data_agent_u19_team_owner` (not superuser, no BYPASSRLS, not a backend member). `runs` has no SELECT policy for this owner, so the first Run-owner check returns null.
- Current source hashes: v1 `0dc209982561f5bfdd5419a9a95139b8821cdb851c17d6e1a6e3dca19302f935`; v2 `7f808ce9084dbbbf83c5bb8e666e61f32c2c909415df6cfe4418472f520b9a2f`.
- Team V2 DTO additionally requires exactly one root; this Run has two. Root tasks have no completion/acceptance rows, while committed public Agent events record their completion. A current projection must preserve these actual Root turns and status sources, not synthesize Team receipts.
- Next migration inventory read: frontier `20260725010812`, next `20260725010813`. A narrow Run SELECT policy plus exact-principal helper EXECUTE grant is needed; do not grant backend membership or bypass RLS. Validate on physical isolated clones before any live migration.
- All live authority/history remains unchanged. New Team trace protocol, migration, focused tests, real database ACL/rollback/history checks, clean-build canary, and forward-epoch formal closure remain pending.

## Implemented read repair and isolated evidence

- 10813 adds only exact-principal Run SELECT plus the existing helper's EXECUTE to the dedicated owner; both RPCs retain their prior source hashes. Checksum `sha256:392a59f42b7340d30c610fffa2f9d7df94eaa0e7aa8a4a71ae0541fb0723966e`.
- V3 preserves multiple Root rounds and generic current Profile IDs; legacy V1/V2 remain frozen. Same-snapshot hash-verified public events supply Root status without inventing completion/acceptance. Missing event/receipt means PENDING.
- Actual event PENDING/RUNNING times preceded DB task timestamps by 4–130 ms. Status ordering uses committed sequence, not cross-host wall clocks. Added regression coverage after the first diagnostic exposed this assumption.
- NAS clone `data-agent-falcon24-f6-team-read-802bf9a5`, port 55455, system identifier `7679852093325762594`. Fifteen history table counts/hashes equal the source before migration and remain equal after rollback/application/replay; migration internally protects 19 tables. Owner read, cross App/Tenant/environment/principal denial, actual INSERT/DELETE denial, and public/anon/authenticated EXECUTE denial passed.
- Restoring data before schema ACLs failed on historical hash checks. That partial DB is preserved as `data_agent_10813_restore_failed`; successful restore used complete schema/ACL first, then data with triggers disabled only during isolated restore. No source data or live history changed.
- Current source reads old Run `179081c9-a6ae-8dc1-b51e-b51d91383c60` stably as 4 tasks / 2 handoffs / 10 epochs / 2 verifier decisions. Two Root statuses are COMPLETED from exact events #15/#33; two specialists are ACCEPTED from existing receipts.
- V3 trace hash `sha256:d3bea3825ef6e9add2a27bec26ebc5d7ff224822f566835b537646847101ada7`; audit `/Users/lienli/.codex/audit/falcon24-e1-authority-reset/f6-team-read-802bf9a5/result.json` is explicitly NON_SCORING, dirty-source diagnostic, zero provider calls and live writes.
- This is not a formal PASS. Remaining: browser gate Team/SQL coverage, clean full build and new canary, fresh-prefix migration verification before live cutover, forward-epoch actual-failure recovery (next migration now 10814), formal four-layer closure.
