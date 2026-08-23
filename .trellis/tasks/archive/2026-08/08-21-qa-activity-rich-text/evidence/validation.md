# Activity Stream And Safe Rich Text Validation

Date: 2026-08-22

## Automated Gates

- Focused Web: 5 files / 25 tests PASS.
- Full Web unit: 100 files PASS, 1 skipped; 362 tests PASS, 1 skipped.
- Web typecheck: PASS.
- Web production build: PASS. Existing Turbopack dynamic-filesystem tracing warnings remain outside this child.
- Contract gate: 10 tasks PASS, including 7 Contracts, 7 Platform, 6 Text2SQL and 32 Agent Runtime assertions.
- Task-owned Biome scope: PASS.
- Full Web lint: HOLD on two unchanged committed files:
  `agent-profiles/route.ts` formatting and `artifacts/[artifactId]/exports/route.ts` import order. No current-child file fails.

## Browser Proof

Automation: `agent-browser`, pipeline/headless mode, authenticated `data-agent-local` profile.

- Real Q&A at 1440x1000: `document.scrollWidth === document.clientWidth === 1440`; actual Text2SQL-only
  run displayed only Text2SQL, with no fabricated Semantic/Report rows.
- Real Q&A at 1024x768: width equality 1024 and Composer visible.
- Real Q&A at 390x844: width equality 390; Composer textarea top/bottom 574/654 inside viewport.
- Rich-text component proof: H1/H2 model content mapped to page H2/H3, one GFM table, one code block, zero `img`,
  exact authorized Artifact link rendered as Inspector action.
- Keyboard: Space collapsed the Think disclosure; Enter expanded Text2SQL; one-level Tool appeared; nested button count 0.
- Browser console contained only React DevTools/HMR development messages; page error list was empty.

Screenshots:

- `browser/desktop-1440x1000.png` — real Q&A plus Composer.
- `browser/qa-mobile-390x844.png` — real mobile Q&A and Composer.
- `browser/rich-text-desktop-1440x1000.png` — rich-text hierarchy and activity stream.
- `browser/rich-text-mobile-390x844.png` — CJK wrapping, one-level Tool, table and code at 390px.

The temporary local rich-text preview route used for component proof was removed before build and commit.

## Trellis Check Finding Closed

The first review found that an aggregated Tool row could expose an Artifact reference using the Tool START sequence even
when the reference was published at END. `artifactReferencesBefore` now scans original Public Run Events and only accepts
same-Run references whose publication event sequence is strictly earlier than the answer block. Regression coverage checks
that sequence 6 cannot authorize its own reference and sequence 7 can.

## Runtime Health After Build

- PostgreSQL and Neo4j: healthy.
- Migration/authority/port readiness: PASS.
- Web: ready at `http://localhost:3000`.
- Run Worker and relationship indexer: started, idle.
- Semantic Authoring: started but waiting on independent `CERTIFIED_MODEL_NOT_READY`.
