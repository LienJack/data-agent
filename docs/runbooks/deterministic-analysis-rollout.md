# 确定性分析分阶段上线与回滚 Runbook

## 目标与不变量

本文只管理 ontology-grounded deterministic analysis。PostgreSQL 中已提交的 Semantic Release、Schema Snapshot、Policy
Receipt、QueryEvidence 与分析 Artifact 仍是 Authority；Capability Probe、前端开关和模型输出都不能提升能力状态。

- 普通 Text2SQL 与历史 AnalysisReport 走独立工具路径；关闭任一分析技能不得修改或停止该路径。
- 一个技能只有同时满足 Release Manifest 注册态、`execution_enabled=true` 且独立 kill switch 未启用时才进入 server-owned
  `AnalysisSkillCatalog`。前端可见不代表可执行。
- `certified-causal-estimate@1` 默认 `NOT_REGISTERED`。只有 F9 已注册、独立 L5 Gate 为 GO 且证据未过期时才允许执行。
- 任一失败、漂移或证据缺失都降级到上一安全阶段；失败/取消/超限不得提交部分输出。

## 当前基线

当前目标是 `SHADOW_READY_WITH_GA_HOLD`：标准模板为 Stage 1 Shadow，Generated Program 为 Stage 2 Shadow，内部 Workspace
可查看 Stage 3 的标准/生成分析与 L4 Root Cause Candidate；L5 保持 HOLD。许可证元数据仍有待人工确认的包，因此所有 GA
promotion 均保持阻断；Python 锁依赖的已知 CVE 扫描为 PASS。

## 阶段与提升门

| Stage | 接入范围 | 必须证据 | 禁止事项 |
|---|---|---|---|
| 0 Fixture | Oracle/SCM/恶意 Fixture | Suite hash、独立 Oracle、100 分 hard-fail | 用户 Run、Generated Program |
| 1 Template Shadow | 标准模板、Sandbox、Oracle 镜像执行 | Runtime/Lock/Image、重放、数学/Metamorphic、预算 | 用户可见、生成代码 |
| 2 Generated Shadow | `open-python-analysis@1` | AST/Import/seed policy、安全拒绝、一次 repair、成本差异 | 第二次 repair、网络/安装/Secret |
| 3 Internal | 内部 Workspace；L4 Candidate | 语义拒绝、证据闭包、RBAC/egress、安全 projection、E2E | 将相关/贡献/L4 Candidate 称为因果 |
| 4 Per-skill GA | 每技能独立 | 该技能所有硬门、shadow 指标、许可证复核、回滚演练 | 批量提升；Forecast 提前提升 |

Stage 4 顺序建议：Data Profile → Semantic Transform → Trend → Robust Anomaly → Association/Quality → Contribution → Visual
Story → Generated Analysis → L4 Root Cause → Forecast。Forecast 必须最后通过时间切分、seasonal leakage 与 backtest 胜出门。
Certified Causal 不沿用这个顺序自动提升，必须另行注册 F9/L5。

## 硬门清单

每次提升都必须保留命令输出、提交 SHA、suite/runtime/lock/image/SBOM hash 与操作者时间：

```bash
pnpm sandbox:python:attest
pnpm sandbox:python:supply-chain
pnpm --filter @data-agent/contracts test:unit
pnpm --filter @data-agent/semantic test:unit
pnpm --filter @data-agent/research test:unit
pnpm --filter @data-agent/evals test:unit
pnpm --filter @data-agent/worker typecheck
pnpm capability:probe -- --deterministic-analysis-only
pnpm verify:release -- --deterministic-analysis
```

此外必须执行 hardened container success/malicious/timeout/cancel、Worker tool gate、E-commerce cross-layer acceptance，以及 Web
projection 的 disclosure/sensitivity/replay 测试。Contribution closure、Association disclosure 和 Forecast leakage 是不可豁免硬门。

## 逐技能开关

1. 在受控 Release Manifest revision 中只改目标 `capability_id`。不要复用全局布尔开关。
2. 熔断时设置 `kill_switch.engaged=true`、稳定 `reason_code`、`execution_enabled=false`；保留原 stage 与证据以便审计。
3. 发布新 Manifest 并由服务端 Authority 解析；确认目标技能从 server-owned catalog 消失，另一标准技能仍能 resolve。
4. 观察该技能的新 Run 变为确定性 SKIPPED/HOLD；确认普通 Text2SQL、历史报告读取和其他分析技能继续工作。

紧急 reason code 使用：`SECURITY_EVIDENCE_STALE`、`REPLAY_MISMATCH`、`ORACLE_REGRESSION`、
`SEMANTIC_CLOSURE_REGRESSION`、`BUDGET_REGRESSION`、`PROJECTION_LEAK`、`LICENSE_REVIEW_REQUIRED`。

## 回滚与恢复

| 触发条件 | 立即动作 | 恢复条件 |
|---|---|---|
| Runtime/Lock/Image 不匹配 | 熔断所有依赖该 profile 的技能；保留 Text2SQL | 重建镜像、三重 attestation、容器 smoke、重放一致 |
| CVE 新发现或 SBOM 漂移 | 相关 profile 全部 HOLD；禁止用旧扫描覆盖 | 升级/移除依赖，重锁、重建、重新扫描并生成新证据 |
| 许可证未知/冲突 | 阻断 GA；Shadow 数据不出用户面 | 安全/法务记录明确 verdict 与范围 |
| 单技能 Oracle/closure 失败 | 只熔断该技能 | 算法版本与 Golden 同步升级，独立 Oracle 100 分 |
| Generated Program 安全拒绝异常 | 熔断 `open-python-analysis@1` | 恶意、repair、zero-output、egress 全部重新 PASS |
| L4 投影出现因果措辞 | 熔断 Root Cause 与相关 projection | disclosure/source closure 回归通过 |
| F9、L5 或 Certificate 过期/漂移 | Certified Causal 立即 NOT_REGISTERED/HOLD | 新 Identification/Refutation/Sensitivity/F9 closure 和有效期 |

回滚不删除 Artifact，也不改写旧 Manifest。创建新 revision，保留触发证据和旧/新 hash。恢复必须创建新 Run，不能把原 HOLD
Run 就地改为 READY。

## 观测与告警

按 `capability_id + algorithm_version + runtime_digest + lock_digest` 分桶观测：执行数、适用/拒绝 reason、Oracle score、重放
match、p50/p95 时间与内存、repair 率、安全拒绝率、zero-output 失败率、敏感 projection 拒绝、每 Run SQL/Python/行数预算。
Shadow 不写入用户可见 projection；Internal 只对授权 Workspace 开放。

以下任一条件自动熔断目标技能：重放不一致、Oracle 非 100、跨 scope/source closure、预算绕过、非成功终态出现输出、敏感字段或
stdout/source 泄漏。F9 未注册只阻断 Certified Causal，不阻断标准分析和 L4 Candidate。

## 发布记录模板

记录：Manifest ref/hash、source commit、suite version/hash、目标技能、from/to stage、kill switch、Runtime/Lock/Image/SBOM、CVE 与
许可证 verdict、硬门命令/receipt、shadow 指标、回滚验证、审批人和有效期。证据不全时结论只能是 `HOLD` 或
`SHADOW_READY_WITH_GA_HOLD`，不得写 `GA READY`。
