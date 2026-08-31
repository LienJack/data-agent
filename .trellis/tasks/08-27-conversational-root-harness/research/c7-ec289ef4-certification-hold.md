# ec289ef4：问答前认证 HOLD 与诊断传播修复

2026-08-31，source `ec289ef495d0969048f329d4d7395873f536a5ed`。
新轻量 C7 profile 已在 ignored helper 冻结，但 **没有提交任何业务问题、没有激活 scratch E17**。
新的零候选真实模型行为仍未证明；前序 b818da8d 的业务/Trace 结果不能拼作本次 PASS。

已完成：force build 8/8（0 cache）；full unit 15/15（6 cache）。Fresh Contracts
106 files / 1098 tests、Agent Runtime 27/173、Web 143/645（另 1 integration skipped）。
generation `sha256:d36afdb0e0d9eab8e7113b3ddd4c206d6bc5580a6353faa50ce8e9df98b72ec5`。
NAS scratch `data-agent-falcon24-e17-ec289ef4`（55479）物理备份 manifest 校验通过；
数据 9 tables / 70 columns / 121445 rows / 1902 NULL，exact content/inventory/subject 一致。

一次认证 Run `b509fd76-2a20-5dc0-9fab-334107fd1a65`，stage
`3ba6b0c6-5f70-4568-b63f-bb54f690f1a7`，结果 `HOLD / CREDENTIAL_SMOKE_FAILED`。
数据库 Run FAILED，event sequence 4 为 tool_failed，5 为 run.failed；没有 certification Artifact。
已验证 code 路径：此错误表示至少一个 conformance check 不通过；不是“未配置凭据”的错误码。
具体失败 check 没有被旧 CLI 持久化，因此不能断言是网络、预算、结构化输出或工具调用中的哪一项。

最小修复仅传播当前认证函数本已返回的 `failed_checks`：按现有
`PROVIDER_CONFORMANCE_CHECKS` 固定名单过滤，写入同 Run tool failure summary 与 CLI HOLD。
不改 smoke prompt、token budget、通过标准、五项 check、重试次数或认证权威。
前述旧失败记录不补写；新的可诊断认证须使用新 clean source 和新不可变 stage。

Focused boundary test 先 red 后 green；Worker boundary/certification 2 files / 14 tests、
Agent Runtime smoke/certification 2/13、Worker typecheck、scoped Biome 与 diff check 通过。
源码边界测试不等于真实新认证已经通过。

回收：本轮唯一 OpenSandbox PID 72828 已停止；没有启动 Web/Worker 或认证浏览器。
55479 转发已取消，scratch 容器停止、volume 保留，本地临时 capability 副本删除。
live before/clone/after 的 348 表指纹完全一致；普通 NAS 数据库及其他历史资源未改动。
审计目录 `/Users/lienli/.codex/audit/falcon24-e1-authority-reset/` 中保留
`e17-scratch-certification-ec289ef4.log`、`e17-dataset-proof-ec289ef4.json` 和 `c7-ec289ef4-*.json`。

任务仍 ACTIVE；这不是已确认的外部依赖阻塞，不结束任务或盲目重试。
