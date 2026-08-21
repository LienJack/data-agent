# Apple Glass Q&A Browser Acceptance

## Target

- URL: `http://localhost:3000/w/908daa22-1bb5-4029-a616-22d0dece1c0b/qa`
- Session: authenticated local Workspace Admin
- Browser: agent-browser Chromium
- Theme: light

## Geometry Matrix

| Viewport | Root scroll/client | Composer | Inspector | Result |
| --- | --- | --- | --- | --- |
| 1440x1000 | 1440/1440 | x248–1440, y806–1000 | closed | PASS |
| 1440x1000 + Inspector | 1440/1440 | x248–1096, y806–1000 | x1096–1440, y52–1000 | PASS, no overlap |
| 1024x768 | 1024/1024 | x248–1024, y574–768 | closed | PASS |
| 768x900 | 768/768 | x0–768, y642–836 | closed | PASS |
| 767x900 | 767/767 | x0–767, y642–836 | closed | PASS |
| 390x844 | 390/390 | x0–390, y548–780 | closed; mobile nav y780–844 | PASS |
| 390x844 + Inspector | 390/390 | x0–390, y548–780 | x0–390, y96–548 | PASS, no overlap |

Existing unit regression also preserves exact container concession: 1280 -> 920/360, 1000 -> 640/360, 959 ->
959/0.

## Computed Material

- Sidebar: `rgba(247, 250, 247, 0.72)`, `blur(24px) saturate(1.32)`.
- Topbar/Inspector: `rgba(251, 253, 250, 0.88)`, `blur(24px) saturate(1.32)`, inset white refraction edge and deep-green tinted diffusion shadow.
- Artifact reading surface: `rgba(251, 252, 250, 0.97)`, `backdrop-filter: none`.
- With `prefers-reduced-motion: reduce`, running pulse and skeleton pseudo-elements both report `animation-name: none`.
- Reduced transparency, no-backdrop support and print are covered by static CSS contract because Chromium does not expose reduced-transparency emulation.

## Screenshots

- `screenshots/qa-glass-desktop-1440.png`
- `screenshots/qa-glass-desktop-inspector.png`
- `screenshots/qa-glass-tablet-1024.png`
- `screenshots/qa-glass-breakpoint-768.png`
- `screenshots/qa-glass-breakpoint-767.png`
- `screenshots/qa-glass-mobile-390.png`
- `screenshots/qa-glass-mobile-inspector.png`

## Findings

- Open task-scoped visual/geometry issues: 0.
- The browser session contains historical Next development HMR/RSC fetch errors accumulated while source and build
  artifacts changed. Current loaded pages, Artifact preview, viewport transitions and API-backed conversation content
  render successfully; production build is validated separately.

## Automated Validation

- Web full unit: 108 passed + 1 skipped; 395 tests passed + 1 skipped.
- Web typecheck, production build, task-scoped Biome and `git diff --check`: PASS.
- The production build reports six pre-existing dynamic filesystem tracing warnings outside this task.
- Full Web Biome is HOLD on two unrelated pre-existing route formatting/import findings; every task-owned file passes.
