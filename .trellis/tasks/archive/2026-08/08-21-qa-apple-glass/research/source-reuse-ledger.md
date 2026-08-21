# Source Reuse Ledger — Apple Glass Q&A Presentation

## Fixed Reference

- DeepSeek Harness checkout: `/Users/lienli/Documents/GitHub/deepseek-harness`
- Fixed commit: `47f943859bef60e4160492346772ded9b24f765a`
- License: MIT, `Copyright (c) 2026 DeepSeek`
- Existing notice: `apps/web/src/components/qa/DEEPSEEK_HARNESS_MIT_NOTICE.md`

## Target Ledger

| Source | Data Agent target | Mode | Material difference | Validation |
| --- | --- | --- | --- | --- |
| Harness `AppFrame` / conversation shell hierarchy | existing `WorkspaceShell`, `QAPage`, `QAInspector` behavioral boundaries | ADAPTED, unchanged in this child | Data Agent keeps PostgreSQL/SSE/store authority and existing Inspector concession; this child changes CSS classes only | existing Inspector/store/replay tests |
| Harness disclosure/document-flow presentation | existing `conversation-activity-stream.tsx` | ADAPTED, unchanged behavior | Artifact frame becomes a near-opaque `reading-surface`; Think/Tool/Subagent rows remain unboxed | activity/Artifact tests + browser screenshot |
| No upstream source | `design-system.css` glass tokens, fallbacks, pseudo-element motion | ORIGINAL | Data Agent cold-neutral palette, deep-green accent, opaque/reduced/print fallback | `qa-glass-material.spec.ts` + computed styles |
| No upstream source | Sidebar/Topbar/Composer/Mobile Nav material mapping | ORIGINAL | Apple-inspired material language only; no Apple/Codex assets or component source | 1440/1024/768/767/390 browser matrix |
| No upstream source | `reading-surface` mapping for Table/VChart/Artifact | ORIGINAL | Data comparison stays high-opacity and non-blurred | computed `backdrop-filter: none` + Artifact screenshot |

Reasonix remains an architectural reference for shared event core / multi-surface adapters only. No Reasonix UI code was
copied. Codex Desktop remains a black-box functional reference. Apple is a material-language reference only; no brand
asset, source code, private protocol, or complete product appearance was copied.
