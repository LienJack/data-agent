# Team read-side boundary

## Observed failure

Build `8921c4cf`, Run `179081c9-a6ae-8dc1-b51e-b51d91383c60`: business/QA pass, Team API returns null and Profile API returns an empty V1 list. No formal PASS was recorded.

## Profile correction

- Current runtime publishes V2 revisions; default list RPC filters V1. Trace now explicitly requests list-result V2 through the existing READ-only `listDiscoverable` port. Existing default/V1 GET and POST are unchanged.
- Client verifies V2 Revision hashes; card renderer can display either historical V1 fixture or current V2 without inventing historical names. Three new tests first failed on V1 response/unsupported version/client parser; focused route/client/Team/Trace tests and Web typecheck passed after the fix.

## Remaining Team repair (not completed)

- Direct read-only scratch audit found four `agent_team_tasks`, including two Root tasks and two accepted Specialist tasks. These are the SAME existing tables used by the public RPC, not a missing new Product Team table.
- `load_agent_team_public_projection` and `_v2` both run as `data_agent_u19_team_owner` (not superuser, no BYPASSRLS, not a backend member). `runs` has no SELECT policy for this owner, so the first Run-owner check returns null.
- Current source hashes: v1 `0dc209982561f5bfdd5419a9a95139b8821cdb851c17d6e1a6e3dca19302f935`; v2 `7f808ce9084dbbbf83c5bb8e666e61f32c2c909415df6cfe4418472f520b9a2f`.
- Team V2 DTO additionally requires exactly one root; this Run has two. Root tasks have no completion/acceptance rows, while committed public Agent events record their completion. A current projection must preserve these actual Root turns and status sources, not synthesize Team receipts.
- Next migration inventory read: frontier `20260725010812`, next `20260725010813`. A narrow Run SELECT policy plus exact-principal helper EXECUTE grant is needed; do not grant backend membership or bypass RLS. Validate on physical isolated clones before any live migration.
- All live authority/history remains unchanged. New Team trace protocol, migration, focused tests, real database ACL/rollback/history checks, clean-build canary, and forward-epoch formal closure remain pending.
