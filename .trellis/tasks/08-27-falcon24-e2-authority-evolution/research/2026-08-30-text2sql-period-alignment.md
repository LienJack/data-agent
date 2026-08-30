# Bug Analysis: yearly comparison omitted the calendar shift

## 1. Root Cause Category

- B (semantic instruction boundary), D (comparison coverage), E (assuming source filtering implies bucket alignment).
- Independent bb84c021 canary Run `1889e750-1b2a-8abc-820d-507432eb5930` succeeded with 37 events. Verified QueryEvidence
  `3c72538e-b292-84f7-9a69-038629d07cfa` contains exactly the twelve expected current months and amounts, but all prior values are NULL.
- Verified SqlArtifact `94bc3e81-03d2-823b-8caa-9ec8185b1874` joins current and prior CTE timestamps directly without the one-year shift.
  Six current months have covered prior-year amounts. Business FAIL; no QA/Trace UI checks or formal PASS.

## 2. Why Fixes Failed

- Host-resolved duration fixed eleven-versus-twelve months and worked in this run. It does not prove comparison SQL semantics.
- Instructions specified the rate and coverage/LEFT JOIN but did not explicitly separate source filtering from bucket alignment.
- This is not the repaired parameterization defect: the accepted SQL has no year interval at all. Model internal reasoning is not observable.

## 3. Prevention Mechanisms

- Add general comparison-offset guidance: shift the prior bucket forward exactly once, or equivalently shift it in its CTE.
  No fixed business SQL, question router, fallback execution, new release authority or weakening of SQL admission.
- Provider prompt regression first failed 1/10, then passed. Broader focused suite 86/86; Worker typecheck and two-file Biome passed.
- Real NAS scratch read-only query after the actual parameterize/policy pipeline: unshifted May comparison returned NULL;
  one-year alignment returned `608213.5400000004`, matching independent source `608213.54`. Both transactions rolled back.

## 4. Systematic Expansion

- Current-window checks, source coverage, calendar alignment, aggregate values and rate formula are separate assertions.
- Prompt regression only proves the instruction reaches the provider. It does not enforce arbitrary comparison SQL or guarantee a model
  follows it. The next independent canary and formal gate must independently compare actual values; failures stay immutable.

## 5. Knowledge Capture

- Updated Text2SQL resolved-context spec with alignment and the no-all-NULL shortcut. No application template counterpart exists.
- Audit result saved under `f6-yoy-canary-bb84c021/result.json`. New clean build/canary and forward live authority remain pending.
