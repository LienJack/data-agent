# 当前核心范围收尾复核

本次完成条件以用户缩小范围后的 **PRD §21 / design §26 / implement §26** 为准。
AC-CORE-01–05 已全部完成，允许交付结束；旧 §20、C7 和更广父任务的未完成增强项是延期历史，
不是自动重启复杂题库的指令。保留父子 task 的 in_progress 历史与关联，不归档、不冒称全局完成。

2026-08-31 只读复核通过：核心四题 4/4、62 份证据文件 SHA-256 全部一致，
原完整 Trace 共 135 节点。业务构建仍是 clean `ec3c1e61`，不是当前后续修复 HEAD。
两道协作题的 same-Run Semantic → SQL → QueryEvidence、公式、来源与真实 UI 证据见
[核心验收报告](core-collaboration-verification-ec3c1e61.md)。没有为收尾重新调用模型。

## 后续修复与证据界限

- `8d4679d4`：Analysis final narrative 接收指标已发布单位；不得依据中文猜币种。
- `b818da8d`：报告委派目标章节改为“分析任务”。额外 C7 趋势首轮真实业务及 99-node QA/Trace
  通过，地区追问 FAILED；该补充观察不改变核心四题与旧 formal 状态。
- `ec289ef4`：补齐零候选 unresolved 映射，Root 澄清与公开解释；Text2SQL 继续在 I/O 前拒绝。
  Worker 48/517、补充 Tool/Answer 2/100、Contracts 30、Root Harness 8 及三包 typecheck 通过。
  真实地区澄清行为尚未验证，不能以单测或已知合同缺口宣称历史 provider failure 已修复。
- `aa5c6a5b`：认证失败只传播五项固定白名单 check 名称，保留 HOLD，不改通过标准或预算。
  Worker focused 14、Agent Runtime 13、Worker typecheck 通过。

`ec289ef4` 认证 `b509fd76-2a20-5dc0-9fab-334107fd1a65` 的旧 `CREDENTIAL_SMOKE_FAILED`
保留，具体失败项当时没有记录，根因不能补猜。
`aa5c6a5b` 新独立认证 Run `08435666-83a6-5eec-884c-3e44199f7571`、stage
`8ac5cfba-69e6-4f0a-90f0-1df831e4c213` 通过全部原检查；没有激活其 scratch E17 或提交业务题。
新 force build 8/8（0 cache）、unit 15/15 tasks（14 cache，非全量 fresh），attestation PASS；
generation `sha256:7193075c29eab045be7c076398228f1c39818354a2ac208af8d1e0fd8b9b53f5`。
这些后续源码没有重跑原核心四题，不与 `ec3c1e61` 证据合并成新构建 PASS。

## 最终现场

live E16 的最新 before/after 348 表指纹完全相同。core/ec289/b818/ad556/aa5 五个本次相关
checkpoint 容器均正常停机，volume 保留；3300/9090/18080、55476–55480 本地端口空闲。
临时能力副本和本轮 browser/auth 均不存在；普通 NAS PostgreSQL/Neo4j healthy，OrbStack 未运行。
共享 SSH master、其他历史数据库/认证/backup/audit 未批量改动。

最新只读审计：`/Users/lienli/.codex/audit/falcon24-e1-authority-reset/current-core-closure-aa5c6a5b.json`。
该检查 model_calls=0；历史 Run/证据、认证失败与后续认证通过均保留，不回填结果。

当前核心交付结论仍为 **CORE_COLLABORATION_VERIFIED**。原四层正式门禁未通过、
production isolation=false/HOLD、live E17 未激活；后续恢复这些延期项必须明确恢复对应范围。
