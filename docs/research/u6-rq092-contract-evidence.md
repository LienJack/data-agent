# U6 RQ092 合同证据快照

> 类型：`REPO_RELATIVE_RESEARCH_EVIDENCE_SNAPSHOT`
> 证据等级：`SYNTHETIC_CONTRACT_PROOF`
> 产品交付声明：`false`
> Release：`HOLD`
> Source Run：`RUN20260727-070114-u6-l2-research-loop-repo-b73fca`

本文是供 Trellis 稳定加载的只读摘要，不是新的研究结论，也不替代
`/Users/lienli/Documents/work/深度调研/research/data-agent-system-design` 下的权威研究
记录。绝对路径只作为来源定位信息保存；任务上下文只引用本仓库文件。

## 1. 内容寻址来源

| 来源 | 原始绝对路径 | SHA-256 |
| --- | --- | --- |
| Reader Answer | `/Users/lienli/Documents/work/深度调研/research/data-agent-system-design/answers/RQ092-在当前-data-agent-的-U6-纵向切片中-L2-Research-Loop-Proof-Ledger-Stop-Controller-与-ReportReady-Authority-应如何形成最小但不可绕过的闭环-并用哪些可重.md` | `8d6b6b22f4edaa53579b7a5f4710421f96967052a0bf7078ad4fb68a65b9df3b` |
| Answer Runtime | `/Users/lienli/Documents/work/深度调研/research/data-agent-system-design/runs/RUN20260727-070114-u6-l2-research-loop-repo-b73fca/artifacts/runtime/RQ092-answer-runtime.json` | `6fd834e3e2228bf270c6b3556bb0ca23fdc90336950715e7fc59879a20e89eb9` |
| Synthetic Proof Result | `/Users/lienli/Documents/work/深度调研/research/data-agent-system-design/runs/RUN20260727-070114-u6-l2-research-loop-repo-b73fca/artifacts/verification/rq092-u6-contract-proof-result.md` | `0908d49c91598999e40c3ecebd946b5a72317283dad6368e418ade660ac6df5b` |

实现或检查阶段不得重新解释路径缺失为“研究未完成”；应先核对本快照的三个 Hash。需要
审计完整研究正文时，再由拥有该课题目录的人工流程打开原始文件。

## 2. 核心义务

1. U6 成功路径只允许 `QUERY + DETERMINISTIC`；Source/Document/Benchmark Evidence
   属于后续单元。
2. Hypothesis、Proof Obligation、QueryEvidence、AtomicClaim、SupportDecision、
   Coverage、Stop、Projection、四 Gate 与 Certificate 必须形成精确 Revision 闭包。
3. Candidate、Agent、Supervisor、Writer、普通 Schema Parse、Mastra Snapshot 和
   Redis 都不能签发领域成功态。
4. Envelope Content Hash 与 Domain Semantic Hash 分离；Crash-Recovery 后领域 Hash
   稳定，新 Attempt 的 Envelope Hash 可以变化。
5. Coverage 从原始输入按 `STALE > FAILED > BLOCKED > SATISFIED > OPEN` 重算；未解决
   material conflict 不能进入 `STOP_READY`。
6. `STOP_PARTIAL` 不是 fallback。只有硬预算封顶、存在可披露受支持子集且没有预算内
   可执行 Query 时才允许；预算仍可执行时必须 `CONTINUE/REPLAN`。
7. `ReportReadyCertificate` 只证明冻结闭包曾满足 Ready 条件；当前消费还必须原子核验
   Version Frontier 与 Revocation。
8. Controlled Fixture 必须由字面 SQL 行和预注册阈值重算，一个 Hypothesis
   `SURVIVED`、一个 `REFUTED`，不能读取 Agent 预填结论。
9. Crash-after-SQL-receipt 恢复不得重复执行两次依赖查询，旧 Fence 与伪造 Checkpoint
   不能提交。
10. U6 protocol fixture 只证明协议；U7 独占 Benchmark Manifest、Answer/Oracle、
    Demo/Holdout 身份与评分，不能复用 U6 字面期望值冒充 Benchmark 真值。

## 3. 仓库冻结补强

当前仓库把 RQ092 义务收紧为以下实现前置条件：

- 历史 `RunTerminal=READY` 不可变，当前授权由
  `CurrentReadiness=CURRENT|REVOKED` 表达；
- 通用 `authorizeRunTerminal(READY)` 永久返回
  `CURRENT_READY_CONSUMPTION_REQUIRED`；
- V1 只允许 `readHistorical*`，所有 Writer/Authority/current-ready/Grant/GO 拒绝；
- ReportReadGrant 的 Consume 只完成单次占用；Response CAS 必须再次核验
  CurrentReadiness/Frontier/Revocation 与 exact bytes/Digest，提交为 `RESPONDED`
  后才允许发送首个字节；
- Release `GO` 必须 current-V2 revalidate Certificate、material Claim/Schema
  Frontier、CurrentReadiness 与 Revocation；
- material Claim 与 Certificate 必须绑定同一当前 Schema Frontier；
- U6 App Migration 只位于
  `infra/supabase/apps/data-agent/migrations/`。

这些补强属于实现合同澄清，不把合成证明升级为产品、Benchmark、Hosted、Docker 或
Release Evidence。

## 4. 证据边界

- 本快照不证明 `packages/research`、PostgreSQL Authority、Mastra Workflow 或 UI 已实现。
- 本快照不证明任何真实 Benchmark、生产效果、Hosted/Docker 部署或签名 Outcome。
- 本快照不能解除 `HOLD`。
- 只有真实实现 Diff、可重放测试结果和签名门禁证据才能更新 U6/Release 状态。
