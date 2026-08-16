# Execution Plan

1. Freeze preflight evidence, GoalExecutionManifest, two isolated Scope IDs, DeepSeek V4 Flash identity and Falcon reuse policy.
2. Execute Contract/Authority segment: U1, U2, U3, U4, U5.
3. Execute early risk slice: U7 and U19.
4. Execute workbench/runtime segment: U10, U6, U8, U9.
5. Execute semantic/extensions/team segment: U15, U11, U12, U13, U14, U20.
6. Execute datasource and product journey: U16, U17.
7. Execute Falcon release gate: U18 over all 28 schemas and 500 cases.
8. Run final cross-layer checks, scoped commit audit, bootstrap/journey/Falcon GO audit and completion review.

For every U-ID:

- activate only its Trellis child task;
- load only current task, direct dependency receipts, owned diff and latest failure evidence;
- write failing/characterization test first where behavior changes;
- use a fresh Codex Worker context when delegated; never reuse a prior implementation context;
- verify focused tests, package typecheck/build and relevant integration/security gates;
- stage only owned paths and create one scoped commit;
- append a checkpoint with commit, receipt, validation and next dependency.

No step may import data, invoke Claude, add billing behavior, lower Falcon thresholds or publish an Agent-generated Candidate without deterministic Authority.
