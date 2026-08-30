# Current Product Team SQL History repair

- Source canary: build `8921c4cf21bfb55c1454787a503a9bad082686d0`, Run `179081c9-a6ae-8dc1-b51e-b51d91383c60`.
- Business and QA PASS (12 months, null gaps, three independent measure panels); Trace failed because Team/Profile and SQL tabs returned empty authority projections. This remains a failed non-formal canary, not a formal PASS.
- SQL root cause: `projectSqlHistory` admitted only old L2 envelopes even though the ordinary Artifact verifier already accepted current Product Team documents. SQL artifact `f496e555-5fa0-884a-93ea-eccd5a554fe1` and QueryEvidence `1ab2635e-0fe2-8026-8d29-9cc0ffb27566` were committed and visible in the same trace.
- Fix: versioned SQL History v2, same PostgreSQL/Artifact authority, exact source binding and private hash-only DTO. Legacy compiler/AST/query digest and ExecutionReceipt are explicitly null, never synthesized. UI names Candidate hash accurately.
- Red: Contracts rejected v2; Platform returned empty current SQL lists and missed snapshot mismatch; Web rendered blank origin/digest. A same-time descending-order regression also exposed the prior comparator reversal.
- Green: Contracts/Platform focused cases, Web trace/route/gate cases, relevant type checks and formatting recorded in execution output. Real scratch read-only diagnostic returned one stable VALIDATED v2 entry with exact SQL/QueryEvidence refs, entry hash `sha256:b0f1dc13502735dcb4a939f1fd66cd6a83333fc51609110bf8b2a0a8086402ce`.
- Boundary: zero live writes, zero Provider calls during diagnosis. Team/Profile read-side repair remains separate unfinished work. Fresh clean-build canary and forward-epoch formal gates remain required; no cross-build evidence stitching.
