# `03a5a2be` 复杂协作预检与 Provider 等待 checkpoint

## 结论

`03a5a2be` 在同一 frozen build、同一 E17 scratch authority 和两条连续 Conversation 上完成 A1、A2、A3、B1、B2；
B3 唯一 Run 在 Root 首次 Provider 调用时收到 DeepSeek 402，尚未进入任何 Specialist。当前状态是
`ACTIVE/WAITING_EXTERNAL`，不是门禁通过、内部代码失败或任务终止。

本 checkpoint 不把 5 个 PASS 与未来运行拼接。Provider 条件恢复后必须从 fresh build/fresh physical scratch 的 A1 开始重跑六题，
再继续 F5/F7 的 15 回合正式门禁。

## 冻结边界

- source commit：`03a5a2befe02d587fc88af0cb1fd40d22c1bc72f`
- generation：`sha256:a22aa6dce5a794f24331c2c2a8c66cd807ccc61f559ebcc4f5e580976bb4f046`
- Web build：`sha256:af8efcf2d4f67c79b4bf3aaf778e80fabff55db657419774635affeebb397525`
- Worker build：`sha256:0ad1fd193e68cdb0c4ea6ed07e595aff2032bb8e436f576873d48d8607f2eeb7`
- scratch：`data-agent-falcon24-e17-03a5a2be`，`cluster_name=falcon24-e17-03a5a2be`，独立 volume
  `data-agent-falcon24-e17-03a5a2be-pgdata`
- scratch authority：E17 `ACTIVE`，baseline `92a3e91f-33ab-512d-9548-4021bce90936`
- live authority：E16；before/after 348 张 authority 表 fingerprint 完全一致

## 本轮不可变结果

| Case | Run | 路由 | 业务/页面结果 |
| --- | --- | --- | --- |
| A1 | `3ef21460-18a9-8d4e-8999-c7fb04202e62` | Semantic → Text2SQL → Analysis | 独立月度 Oracle、stage exact、QA/Trace 73 nodes PASS |
| A2 | `ad5b9481-401d-8bef-87fd-a182df9f5e48` | Semantic → Text2SQL → Analysis | 48 行分组 Oracle、两图、QA/Trace 76 nodes PASS |
| A3 | `36d8eaf7-2925-8510-92c9-9f72f3da8e3b` | Semantic → Text2SQL → Analysis | 经营摘要与两图、QA/Trace 76 nodes PASS |
| B1 | `b6abfaf9-3db8-82ec-a9fa-7fc3c4cdf142` | Semantic → Text2SQL | 已发布 `formula.marketing_roas`、4 渠道源表复算、QA/Trace 42 nodes PASS |
| B2 | `071f0145-74f9-8099-9d1f-592a9e1569b3` | Semantic → Text2SQL | `REQUEST_ONLY/NONE` 净 ROI、无 ROAS 结果列复用、QA/Trace 42 nodes PASS |
| B3 | `2855437c-4431-8646-8e47-f5e89d0fc174` | 未进入 Specialist | 5 events，`PROVIDER_INVOCATION_OUTCOME_UNKNOWN`，0 Artifact，immutable FAILED |

B2 的 Conversation 历史仍可检索到已发布 ROAS 对象，这是合法上下文，不等于复用结果列。验收按当前 Run 的
`semantic_binding.columns` 判定：净 ROI 是 `REQUEST_DERIVED`，绑定唯一 `REQUEST_ONLY/NONE` 的
`AGGREGATE_RATIO(SUM_BEFORE_RATIO, SUBTRACT_DENOMINATOR, NULL)`，QueryEvidence 没有
`formula.marketing_roas` 列，且四渠道结果逐行等于独立源表的 `(revenue-spend)/spend`。

## 外部条件证据

B3 的 Worker 结构化日志记录 DeepSeek `402 Insufficient Balance`，`delivery_certainty=DISPATCHED_OUTCOME_UNKNOWN`；因此旧 Run 不重提。
随后调用 DeepSeek 官方只读 `GET /user/balance`，返回 HTTP 200、`is_available=false`。该探针不调用模型、不创建 Run、
不写 authority，也不记录 Secret 或具体余额。接口语义见
[DeepSeek 查询余额](https://api-docs.deepseek.com/zh-cn/api/get-user-balance/)。

首个无模型探针：
`/Users/lienli/.codex/audit/falcon24-e1-authority-reset/complex-03a5a2be/provider-balance-probe-00.json`。

## 清理与恢复

- `complex-03a5a2be-after.json`：live E16 与 before 348 表完全一致。
- `complex-03a5a2be-runtime-cleanup.json`：Web/Worker、两个 browser session/auth profile 和 55523 转发已关闭；
  scratch container 已停止，volume 保留；普通 NAS PostgreSQL/Neo4j healthy；OrbStack 未启动。
- OpenSandbox Server 为共享 NAS control plane，未由本 attempt 删除；本轮 Analysis sandbox residual 为 0。

唯一恢复步骤：

1. 以 `5m -> 15m -> 30m`、最高 30 分钟的无模型余额探针复查 `is_available`；false 时不创建 Run、不启动昂贵服务。
2. 首次变为 true 后，确认 live E16 与 checkpoint fingerprint 一致、3300/9090 和新数据库端口空闲。
3. 从当前 clean HEAD force build/attestation，建立新的专用 physical scratch、迁移、dataset clone、认证和 scratch-only E17 activation。
4. 新建浏览器 vault/session 与两条 Conversation，从 A1 到 B3 各提交一次；不复用或拼接本轮 5 个 PASS。
5. 六题完整闭合后继续 F5/F7 15 回合正式业务、同 Run QA/Trace、authority 与最终清理。
