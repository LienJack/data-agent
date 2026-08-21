# Codex Desktop Functional Parity Matrix

Codex desktop is a black-box functional reference. This matrix records observable behavior, not assumptions about its
private implementation or protocol. Target status is `MATCH` unless Data Agent authority or browser constraints require
`ADAPTED`; excluded private/local-only behavior is `OUT_OF_SCOPE`.

| Capability | Target | Data Agent adaptation | Required proof | Current |
| --- | --- | --- | --- | --- |
| Think/Tool/Subagent and answer text appear in event order | MATCH | PostgreSQL Run sequence is authority | real SSE recording + refresh screenshot | MATCH — Runs `93d66234…` and `43e3092d…` replay 1→28 without reordering; desktop proof retained with the archived UI task |
| Think/Tool/Subagent start collapsed | MATCH | public summaries only | keyboard/component test | MATCH — focused Web tests plus real disclosure ARIA state |
| Enter/Space and visible focus operate disclosure | MATCH | sibling disclosure/entity controls | ARIA snapshot + Playwright | MATCH — Enter expands, Space collapses; scoped component tests pass |
| clicking a file opens right-side preview | ADAPTED | governed ArtifactReference, not arbitrary local path | SQL/REPORT/TABLE preview browser proof | ADAPTED — exact `SqlArtifact` preview and content hash shown; wrong hash fails stale with no raw fallback |
| clicking a Subagent opens right-side live activity | ADAPTED | durable baseline + same Run SSE | running/reconnect/terminal browser proof | ADAPTED — exact profile/task baseline, cursor replay and terminal closure use the same public Run log |
| Inspector selection switches without losing conversation position | MATCH | QA store selection from parsed snapshots | scroll/focus Playwright | MATCH — strict URL target and store tests preserve conversation selection |
| Inspector can close and return focus | MATCH | deterministic trigger identity | keyboard Playwright | MATCH — real browser focus returned to exact Text2SQL trigger id |
| desktop Inspector can resize and restore preference | MATCH | 320–520px; protect 640px center | drag/reload Playwright | MATCH — 320→344px keyboard resize persisted through reload; layout solver protects 640px center |
| narrow viewport remains usable | ADAPTED | content sheet above Composer | 390x844 screenshot + composer action | ADAPTED — Inspector sheet and two-row Composer remain visible with zero horizontal overflow |
| running/completed/failed/skipped/blocked and duration are visible | MATCH | strict public status vocabulary | state matrix snapshots | MATCH — assembler/component matrices cover every public status and terminal closure |
| SSE disconnect is distinct from Agent authority | ADAPTED | reconnecting badge, status unchanged | forced disconnect/replay test | ADAPTED — queued Run refreshed at sequence 1, reattached with `cursor=1`, and Worker closed it at sequence 28 |
| refresh restores order and Inspector target | MATCH | strict URL target + replay | reload Playwright | MATCH — consecutive double reload retains conversation/target; terminal answers project from replay when message indexing was interrupted |
| Inspector can locate the same trajectory sequence | MATCH | `run_id + anchor_sequence` | bidirectional deep-link test | MATCH — `event=7` opens, scrolls, expands and marks the exact Resolution Trace node |
| private chain-of-thought or Codex private protocol | OUT_OF_SCOPE | public summary only | negative contract tests | OUT_OF_SCOPE — only server-authored public reasoning summary is accepted; private-shaped targets are rejected |
| arbitrary Codex host filesystem access | OUT_OF_SCOPE | Workspace Artifact Preview only | path-denial tests | OUT_OF_SCOPE — no host `openFile`; only authenticated exact ArtifactReference Preview is reachable |

Each row must end with evidence and one of `MATCH`, `ADAPTED`, or `OUT_OF_SCOPE`; `PLANNED` is not an acceptance result.
