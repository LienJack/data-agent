# Implementation plan: Falcon24 语义生命周期与 Agent 分析验收

## Ordered units

- [ ] U0 Baseline and task setup
  - 固定 `dev@ec28800e`，记录 dirty-base 隔离和 overlap preflight。
  - 读取相关 backend/frontend specs、既有语义/分析/沙箱/评测实现与历史 acceptance artifacts。
  - 建立 scoped validation matrix 和每单元 commit 边界。
- [ ] U1 Semantic production lifecycle
  - 增加 `SemanticAssertionCandidate@1`、`SemanticChangeSet@1`、provenance/conflict/validation contracts。
  - 实现候选归一化、identity resolution、change compilation、deterministic validator 与 publish projection tests。
  - 保持 PostgreSQL authority 和现有 Candidate/Release V2 兼容。
- [ ] U2 Hybrid retrieval, inference and pruning
  - 增加 retrieval/inference receipts 与 `ResolvedContextPackage@3`。
  - 实现 route adapters、RRF、typed expansion、mandatory closure、budget pruning 和 PG fallback。
  - 替换 deferred routes，补 golden/metamorphic/permission/frontier/degradation tests。
- [ ] U3 Falcon24 semantic package
  - 扩展 Falcon24 ontology/analysis semantics、公式、血缘、时间窗口、统计方法 applicability 和 data-quality assertions。
  - 构建可重放 manifest/coverage，明确订单金额、库存双源和客户时序异常权威边界。
  - 增加覆盖/identity/hash/schema-drift tests。
- [ ] U4 DeepSeek generated Python path
  - 增加固定 `deepseek-v4-flash` 的 `AnalysisProgramSourcePort` production adapter。
  - 增加 AnalysisPlan@2 multi-input DAG、五题 program descriptors、static admission、一次修复和 receipt binding。
  - 验证 provider payload redaction、profile non-escalation、sandbox zero-output 和 replay identity。
- [ ] U5 Five-question acceptance and UI
  - 建立 `falcon24-agent-analysis-suite@1` public/sealed fixtures 与五个独立 Oracle。
  - 实现五题完整 Agent E2E、正确 association/HOLD projection、5/5 hard gate、每题 generated-Python gate。
  - 将安全 report/receipt/limitations 投影到现有 Q&A/Test Center UI，并验证 live/refresh/replay 一致。
- [ ] U6 Final review and integration
  - 跑 contracts/semantic/research/evals/worker/platform/web/sandbox targeted tests、typecheck 与 cross-layer acceptance。
  - 冷/暖各三次；记录外部 provider/DB 阻断时的准确 HOLD 证据，不用 fixture 冒充 live。
  - 执行 correctness/security/maintainability/testing/agent-native review，修复所有 confirmed findings。
  - 更新 durable specs，逐路径 stage，`git diff --cached --check`，完成 scoped commits。
  - 预检与 `dev` 的 merge-tree overlap，合并回 dirty base，恢复并复验用户原有改动。

## Validation matrix

- Contracts: `pnpm --filter @data-agent/contracts build && pnpm --filter @data-agent/contracts test:unit`
- Semantic: `pnpm --filter @data-agent/semantic build && pnpm --filter @data-agent/semantic test:unit`
- Research/Sandbox: targeted Vitest plus `services/sandbox` policy/runtime tests and runtime attestation.
- Evals: Falcon24 suite public/sealed boundary, five Oracles, adversarial and replay suites.
- Worker/Platform: provider adapter, planner/executor, repair/fence/idempotency and cross-layer suites.
- Web: report/receipt/limitation projection tests plus browser acceptance when the stack is available.
- Release: 5/5, generated Python=5/5, model profile exact match, 3 cold + 3 warm, flake=0, no hard HOLD.
- Git: `git diff --check`, explicit staging, `git diff --cached --check`, scoped commit log, merge-tree preflight.

## Commit boundaries

1. `chore(task): plan Falcon24 semantic lifecycle acceptance`
2. `feat(semantic): govern assertion production lifecycle`
3. `feat(semantic): retrieve and infer bounded semantic context`
4. `feat(falcon): publish analysis semantics for db24`
5. `feat(analysis): execute DeepSeek generated Python plans`
6. `test(evals): certify Falcon24 agent analysis suite`
7. `chore(task): close Falcon24 semantic lifecycle acceptance`

## Rollback points

- 每个能力提交都可独立 revert；合同只做 additive versioning。
- 未通过 route/projection gate 时保留 PG lexical path，不开启多路消费。
- 未通过 generated-code gate 时关闭 generated-python skill，不影响标准分析/Text2SQL。
- 未通过 5/5 时保持 suite/release HOLD，不删除证据。
