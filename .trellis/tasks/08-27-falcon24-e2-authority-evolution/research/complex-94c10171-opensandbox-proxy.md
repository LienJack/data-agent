# `94c10171` A1 NAS OpenSandbox endpoint mode 复盘

## 冻结事实

- source commit：`94c10171fff799a798fa1b8e19dc0507c6a3de02`
- scratch：`data-agent-falcon24-e17-94c10171`，专用 volume 保留
- A1 Run：`818af266-7161-877d-8801-725d3ff609bc`，终态 `FAILED`
- QueryEvidence Artifact：`e7e1f43c-7bde-8b23-a36f-492f1ea8c2e4`
- live authority：before/after 均为 E16、348 张表，完整指纹一致

该 Run 的 Semantic 与 Text2SQL 已接受，SQL 证据也已形成；随后两个 Analysis candidate 均在
`analysis.program.execute` 等待 Sandbox side effect 时超时，最终以
`ROOT_AGENT_TURN_BUDGET_EXHAUSTED` 结束。失败 Run 不重提，也不将已成功的前两层拼入后续构建。

## 根因

本机 Worker 通过 SSH 只访问 NAS OpenSandbox 管理 API `127.0.0.1:18080`，但运行环境仍设置
`ANALYSIS_SANDBOX_USE_SERVER_PROXY=false`。DIRECT 模式要求 Worker 能连接 Docker 为每个 Sandbox
临时发布的 NAS endpoint；这些端口没有转发到本机，因此管理 API 可用不等于 Cell/execd 数据面可用。

这不是 Semantic、Text2SQL、公式、Python program 或数据质量失败。相同 commit、镜像和 runtime 在
`use_server_proxy=true` 下先完成简化真实探针：创建 Sandbox、执行 `1 + 1`、关闭、管理残留为零，耗时
9686ms，且模型调用和 live 写入均为零。审计为
`/Users/lienli/.codex/audit/falcon24-e1-authority-reset/nas-opensandbox-proxy-probe-94c10171.json`。

随后用修改后的正式 `scripts/verify-opensandbox-analysis-runtime.ts` 完成完整 SERVER_PROXY 探针：

- Agent/Operator 为两个不同 Sandbox；
- Agent 中不存在 Operator package；
- Cell policy 正例准入、系统 import 反例拒绝；
- stateful symbols 精确闭合；
- `multiple-testing.bh-fdr@1` registry/operator binding 及 3 行结果通过；
- 单一 operator receipt 与 closure hash 通过；
- session 关闭，管理 API 与 NAS Docker residual 均为 0。

## 修复与边界

- runtime probe 不再把 `true` 无条件拒绝，而是按配置报告 `DIRECT` 或 `SERVER_PROXY`；探针主体和治理检查不变。
- NAS spec 与 demo runbook 明确：同机/临时端口可达才用 DIRECT；本机 Worker 只经 SSH 访问 NAS 控制面时必须用 SERVER_PROXY。
- immutable runtime attestation 中既有本地 DIRECT 证据不改写；代理探针只是当前部署拓扑证据，不证明 production isolation。
- A1 仍为 FAILED。live after 审计位于
  `/Users/lienli/.codex/audit/falcon24-e1-authority-reset/complex-94c10171-after.json`，与 before 完全一致。
- Web、Worker、两个 browser session 和 SSH 转发已关闭；scratch container 已停止，专用 volume 作为失败 checkpoint 保留。

下一次必须使用新 clean build、fresh physical scratch 和 SERVER_PROXY，从 A1 开始重跑六题；不得复用本次
Semantic/Text2SQL 成功前缀，也不得把无模型 runtime probe 记为业务题 PASS。
