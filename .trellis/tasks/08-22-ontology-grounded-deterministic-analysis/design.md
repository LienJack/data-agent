# Design: ontology-grounded deterministic analysis

## Authority boundaries

PostgreSQL Published Semantic Release, schema/policy receipts, and the frozen Resolved Context are the semantic authority. The analysis context
compiler materializes a run-bound capability view but does not create another semantic authority. Neo4j and other indexes remain rebuildable
navigation projections.

The model may select registered skills and submit SQL/Python candidates. The Host owns admission, budgets, runtime profiles, dependency locks,
fences, retries, idempotency, output contracts, and public projection. SQL always traverses the existing semantic compile and QueryEvidence
chain. Python receives only committed Arrow/CSV/JSON artifacts and has no DSN, secret, network, package-install, or host-path capability.

## Data and evidence flow

1. Freeze principal, datasource, semantic release, schema snapshot, policy, and resolved context.
2. For uploaded files, use a fixed parser to produce content-addressed tabular artifacts and a TabularImportReceipt; never open XLSX from model
   code.
3. Compile AnalysisContext and a bounded AnalysisPlan DAG from published capabilities and approved dimensions.
4. Produce governed QueryEvidence, then admit a frozen template or model-generated SandboxProgram with runtime/lock/seed/output closure.
5. Execute through the independent Python sandbox and commit output only after success, current fence, and output-contract validation.
6. Independently verify schema, mathematics, metamorphic invariants, replay identity, and derivation hash before accepting
   DerivedAnalysisEvidence.
7. Project accepted evidence into versioned claims, charts, insights, completion receipts, and reports. The browser never recomputes authority.
8. Root-cause work enters L4 DiscoveryCandidate first. Only a complete L5 identification/refutation/certificate chain authorizes a causal
   claim; otherwise public wording remains candidate/association/HOLD.

## Compatibility

- Preserve all existing @2 readers, wire meanings, and hashes.
- Introduce explicit new payload versions for analysis context/source material, AtomicClaim/Report, chart projection, L4 discovery, and L5
  causal artifacts.
- Unknown versions, algorithms, runtime locks, stale refs, cross-run refs, and missing disclosures fail closed.

## Runtime profiles

- CORE_ANALYSIS: deterministic profiling, transforms, statistics, charts, and time-series baseline functions.
- ML_DIAGNOSTIC: constrained sklearn/networkx/shap/causal-learn exploration, never causal authority.
- CAUSAL_L5: isolated DoWhy/EconML execution only for registered L5 skills.

Each profile has its own lock, image/runtime digest, attestation, SBOM/license/CVE evidence, malicious fixture suite, numeric goldens, and release
gate. The descriptor chooses the minimum profile; the model cannot choose or upgrade it.

## Failure, retry, and rollback

- Critical semantic, query, sandbox, Oracle, disclosure, or certificate failures HOLD; optional node failures may produce PARTIAL with explicit
  limitations.
- A failed generated program may create at most one scrubbed, non-expanding revision. Retries reuse the accepted plan and identical inputs;
  version/frontier drift requires a new plan revision.
- Cancellation, timeout, resource exhaustion, stale fence, or sandbox failure commits no partial output.
- Each skill is separately registered and kill-switchable. Disabling analysis must not break Text2SQL or historical reports.

## Implementation ownership

The canonical plan's U1-U8 file lists are the initial ownership map. Existing module boundaries may justify a different file owner only when
the same authority, wire, security, and verification boundaries remain intact and the adjustment is recorded in implementation evidence.
