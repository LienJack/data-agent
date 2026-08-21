# Codex Desktop Functional Parity Matrix

Codex desktop is a black-box functional reference. This matrix records observable behavior, not assumptions about its
private implementation or protocol. Target status is `MATCH` unless Data Agent authority or browser constraints require
`ADAPTED`; excluded private/local-only behavior is `OUT_OF_SCOPE`.

| Capability | Target | Data Agent adaptation | Required proof | Current |
| --- | --- | --- | --- | --- |
| Think/Tool/Subagent and answer text appear in event order | MATCH | PostgreSQL Run sequence is authority | real SSE recording + refresh screenshot | PLANNED |
| Think/Tool/Subagent start collapsed | MATCH | public summaries only | keyboard/component test | PLANNED |
| Enter/Space and visible focus operate disclosure | MATCH | sibling disclosure/entity controls | ARIA snapshot + Playwright | PLANNED |
| clicking a file opens right-side preview | ADAPTED | governed ArtifactReference, not arbitrary local path | SQL/REPORT/TABLE preview browser proof | PLANNED |
| clicking a Subagent opens right-side live activity | ADAPTED | durable baseline + same Run SSE | running/reconnect/terminal browser proof | PLANNED |
| Inspector selection switches without losing conversation position | MATCH | QA store selection from parsed snapshots | scroll/focus Playwright | PLANNED |
| Inspector can close and return focus | MATCH | deterministic trigger identity | keyboard Playwright | PLANNED |
| desktop Inspector can resize and restore preference | MATCH | 320–520px; protect 640px center | drag/reload Playwright | PLANNED |
| narrow viewport remains usable | ADAPTED | content sheet above Composer | 390x844 screenshot + composer action | PLANNED |
| running/completed/failed/skipped/blocked and duration are visible | MATCH | strict public status vocabulary | state matrix snapshots | PLANNED |
| SSE disconnect is distinct from Agent authority | ADAPTED | reconnecting badge, status unchanged | forced disconnect/replay test | PLANNED |
| refresh restores order and Inspector target | MATCH | strict URL target + replay | reload Playwright | PLANNED |
| Inspector can locate the same trajectory sequence | MATCH | `run_id + anchor_sequence` | bidirectional deep-link test | PLANNED |
| private chain-of-thought or Codex private protocol | OUT_OF_SCOPE | public summary only | negative contract tests | PLANNED |
| arbitrary Codex host filesystem access | OUT_OF_SCOPE | Workspace Artifact Preview only | path-denial tests | PLANNED |

Each row must end with evidence and one of `MATCH`, `ADAPTED`, or `OUT_OF_SCOPE`; `PLANNED` is not an acceptance result.
