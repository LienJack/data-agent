# Bug Analysis: comparison source included unpublished historical periods

## 1. Root Cause Category

- B (cross-layer contract), D (test coverage), E (implicit proof assumption).
- Fresh clean-build `d0efdda7` non-formal Run `e02f9478-d59a-881e-98fa-05b5ace4bf45` succeeded with twelve correct current buckets and correct
  annual alignment, but comparison values included March/April 2023 outside the published inclusive start `2023-05-01T00:00:00.000Z`.
- QueryEvidence `0a218a61-9a43-814b-bc44-f7153313b923` hash `sha256:bd3744e6f9d5bf3af4e9ef62cdaa7d1b18d99512b929fd8dcee0e34849ed550f`:
  physical prior/rate oracle passed; governed covered prior/rate oracle failed. Original parameter vector was not retained in its SQL
  projection; do not invent the model's exact bound values. No QA or Trace acceptance was attempted for this failed business canary.

## 2. Why Fixes Failed

- The relative-month operator fixed duration; yearly alignment fixed an all-NULL prior join. Neither proves coverage of every physical scan.
- Existing binder checks only declared current-window boundaries. Provider coverage guidance was insufficient: the model returned real
  physical March/April records, which are not eligible complete prior months under the frozen release.
- RED regressions reproduced source overflow acceptance, absent prepared coverage, missing binding/column acceptance and hidden diagnostics.
  Worker tests initially still imported old Platform dist; rebuilding the dependency exposed the exact optional-property type error and
  enabled real cross-package verification. Never replace the exported-package import with a test-only source alias to mask this boundary.

## 3. Prevention Mechanisms

- Derive comparison coverage from verified SemanticQueryContext and the frozen schema, then pass it through the existing prepared-context
  and PostgreSQL AST policy path at compile and execute. Require direct conjunctive bounds for every physical source scan.
- Keep source filtering, current output window, annual alignment and independent business arithmetic as separate obligations.
- Safe coverage rejection uses the existing bounded repair with clipped explicit parameters; no SQL template, keyword route or new
  publishing authority was added. OR/NOT, wrong aliases, outer-only filters and JOIN-only filters fail closed.

## 4. Systematic Expansion / Proof Boundary

- Scratch port 55453 read-only PostgreSQL proof: out-of-coverage SQL rejected before query I/O; clipped query returns twelve current rows,
  six unavailable prior values as NULL, and six covered prior values matching 608213.54, 505227.66, 567639.91, 623472.35, 571117.81, 578369.83.
- The guard intentionally proves only explicit calendar-day parameter bounds; unsupported offsets/arithmetic are rejected, not guessed.
  Null bounds are not a promise of availability. No-comparison contexts keep their previous behavior.
- Focused policy/binder/runtime/provider/tool suite: 145/145 pass, including safe terminal diagnostics when a bounded repair is rejected.
  Platform and Worker typechecks, owned-file Biome and diff whitespace checks are required before commit.
- This is focused repair evidence, not formal gate acceptance. Live authority remains unchanged; failed history is immutable. A scoped
  commit, clean build and fresh independent conversation are required before another model business check.

## 5. Knowledge Capture

- Updated backend Text2SQL resolved-context spec with binding derivation, proof subset, error matrix and required negative tests.
- No `src/templates/markdown/spec/` exists in this application; no second framework/template authority was introduced.
