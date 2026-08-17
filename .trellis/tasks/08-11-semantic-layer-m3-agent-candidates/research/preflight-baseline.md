# M3 Preflight Baseline

Date: 2026-08-11
Task status: planning; no product-code edits made

## Type baseline

| Package | Result |
| --- | --- |
| `@data-agent/contracts` | PASS |
| `@data-agent/semantic` | PASS |
| `@data-agent/platform` | PASS |
| `@data-agent/web` | PASS |

## Unit baseline

| Surface | Result |
| --- | --- |
| Contracts full unit | PASS — 32 files, 559 tests |
| Semantic full unit | PASS — 9 files, 94 tests |
| Platform catalog + semantic | PASS — 7 files, 27 tests |
| Web governance config + composition | PASS — 2 files, 7 tests |

The first Web command also collected generated `.next/standalone/apps/web/test/**` copies and failed
because that generated subtree has no local tsconfig. The same source tests pass when the verified
command excludes `.next/**`. M3 focused Web commands must carry that exclusion; generated `.next`
content is not an M3 source or test target.

## Worktree boundary

The worktree already contains unrelated modified/untracked DataFoundry, Test Center, model runtime,
frontend design and generated files. M3 must prefer new files and narrowly review every edit to an
existing export, component, migration runner or integration script. Nothing outside the approved M3
manifest may be staged or claimed as M3 work.
