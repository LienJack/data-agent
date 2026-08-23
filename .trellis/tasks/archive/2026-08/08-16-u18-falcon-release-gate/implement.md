# U18 Implementation Plan

## 1. Preflight

- [x] 验签 U17、Falcon bundle、28 schema、Provider credential/certification 与 fresh PG17 migration chain。
- [x] 冻结 dataset/model/profile/oracle/runtime identity 和技术预算。

## 2. Contracts And Authority

- [x] 新增 28-package release index、usage/case evidence、score/stability/submission 与 final gate artifact 合同。
- [x] 复用 PostgreSQL Run/Task/Artifact Authority；Evaluation batch 使用内容寻址 checkpoint，不新增重复 Falcon 专表。
- [x] 覆盖 hash/identity/required closure、bypass、sealed taint 和 idempotency tests。

## 3. Worker Agent Team

- [x] 实现 `FalconTeamRunner`，真实 Provider + Text2SQL child + sealed Oracle + Team/Verifier evidence。
- [x] 接入 Worker CLI，支持 durable checkpoint、resume、fresh labeled run 和 bounded concurrency。
- [x] DEMO/db24 增加 Report child 与 claim-citation verifier（17 个唯一 case）。

## 4. Semantic Release

- [x] 从 public corpus 生成 28 package candidate/coverage；db24/db14 执行 mandatory assertion。
- [x] prepublish gate 后一次性发布 generation 1 Release Set 并冻结 hash。
- [x] 每题生成绑定实际 package/object/mapping/join 的 SemanticUsageReceipt。

## 5. Falcon Execution

- [x] 跑 DEMO/TUNING 并修复可证明问题；holdout blind gate 4/5。
- [x] 跑 DEV 309，first/final 264、per-db >=0.60、309 terminal。
- [x] 冷重启跑 Stability Suite，54/54 outcome stable、flake=0。
- [x] 跑 TEST 191，生成 complete unscored submission。

## 6. Product And Verification

- [x] Web Falcon inline evaluator 失败关闭；正式创建只允许 Worker，Web 保留只读运行/Gate 表面。
- [x] 生成并验签 final GO artifact 与 runbook。
- [x] 跑 Contracts/Evals/Agent Runtime/Worker/Web/PostgreSQL 门禁；Platform 474/475，唯一失败属于并行 semantic-induction fixture 漂移。
- [ ] scoped commit、归档；随后进入 `design-taste-frontend` 全站重设计。

## Final Evidence

- Gate：`sha256:819aa715a6eaafd1ebcec420aa9e742f06ca30a9aa86d4aaaac63d44920c2d57`
- DEV：264/309，16 个数据库全部 >=60%，309/309 terminal。
- Absolute：DEMO 10/10、db14 32/32、db24 17/17、Holdout 4/5。
- TEST：191/191 submitted、0 local verdict。
- Evidence：500 Team、500 SemanticUsage、500 ProviderInvocation、17/17 Report citation。
- Stability：PostgreSQL 17 cold restart，54/54 outcome stable、flake=0。
