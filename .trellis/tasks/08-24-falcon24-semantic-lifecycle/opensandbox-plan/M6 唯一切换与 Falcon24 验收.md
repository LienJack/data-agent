# M6 唯一切换与 Falcon24 验收

## 目标

在全链路验证后一次性切换到 OpenSandbox Cell runtime，删除旧 UDS/`main(context)` 路径，并以真实 Falcon24 数据和 DeepSeek Agent 证明生成、召回消费、逻辑推断、Python 分析、表格图表与恢复能力。

## 实现步骤

1. 冻结新合同和 runtime image/operator manifest digest，运行 contract/integration/security/supply-chain tests。
2. 对五道题逐题跑 COLD/WARM smoke，修复语义缺口、Cell/算子调用、机器精度、图表和 Oracle。
3. 执行五题 × 两种缓存模式 × 三次 = 30 次新鲜 DeepSeek Agent 运行，保存 run/artifact/receipt/oracle manifest。
4. 删除旧 UDS Python client/server、wire protocol、`SandboxProgram@2`、`main(context)`、compose service、fallback 和 dead tests。
5. 运行依赖扫描、全量 typecheck/test/release gate；确认 SQL Sandbox 不受影响。
6. 以 scoped commits 提交，在目标 checkout 合并后重新刷新依赖并复验。

## 代码分析

### 结构与职责

- `AnalysisProgram` 仍是跨 SQL/analysis/oracle 的权威 DAG；Cell program 是其中 Python 节点的唯一执行细节。
- Falcon acceptance recorder 只接受真实 provider、真实数据证据、真实 sandbox receipts、表格/图表和独立 Oracle。
- 删除验证覆盖源码、配置、依赖、镜像、compose、测试和生成产物，防止“死代码兼容层”。

### 关键实现

30 次运行必须固定模型标识、semantic release/context digest、operator manifest、runtime image 和 Oracle 版本，同时保留每次独立 run id。COLD/WARM 只改变允许的缓存状态，不得复用最终答案。每题验证数据质量边界和自然业务问题，不在题目中提示 Python 或统计方法。

Q1 等恒等式使用未舍入机器数；图表/文字仅展示格式化副本。每个失败都进入 M5 taxonomy，并验证重试是否只重放必要 Cell。

### 风险与坑点

- 先删旧路径再证明新路径会扩大不可恢复窗口；应在隔离 worktree 中先完成新路径验证，再在同一切换提交删除旧代码。
- 只跑单元测试不能证明 provider、sandbox、数据和 artifact 集成。
- 暖缓存若复用旧答案会制造假稳定；必须验证输入和执行 receipts。
- shared dirty tree 可能混入他人改动；只 stage 任务拥有文件。

## 验收标准

- 30/30 新鲜运行通过、flake=0；每次都有表格、图表、operator/cell receipts、Oracle 通过和安全 fence。
- 五题分别覆盖经营分解、配送体验、库存损坏、营销增量关系、cohort retention 与数据质量说明。
- `rg`/依赖图证明旧 UDS runtime、旧 wire envelope、`SandboxProgram@2`、`main(context)`、fallback、双写引用为 0。
- SQL Sandbox 回归通过；PostgreSQL/语义发布/AnalysisProgram/Oracle 权威未迁移到 OpenSandbox。
- release/supply-chain/security/cleanup gates 全绿，任务变更形成 scoped commits。

## 备注

若生产 Kata/Cilium 隔离环境当前不可用，功能实现可以完成，但发布 gate 必须保持失败且不能宣称生产完成；这不是启用旧 runtime 的理由。
