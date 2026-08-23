# U11 归纳 Grounding Drift Impact 与 Metric 维护

## Goal

在 U5 Candidate Plane、U10 Job Center 与 U15 Knowledge Base 之上，建立可审计的语义归纳与维护能力：从结构化 Schema、受治理文档和 Metric 交换包生成稳定、可复现、仅供审核的 Semantic Candidate；对后续漂移只重算受影响闭包，并输出 Impact Plan。U11 不得发布 Release，也不得绕过 U5 Review/Publish Authority。

## Requirements

- 支持 `SCHEMA_INDUCTION`、`DOCUMENT_INDUCTION`、`FOUNDATIONAL_GROUNDING`、`DRIFT_REPAIR` 与 `METRIC_IMPORT` 五类请求；结构化源与文档源共享 Proposal Envelope、Evidence Locator 与 Candidate 输出，但使用不同解析器和泄漏防护。
- 首次构建允许 `base_release_ref = null`，后续维护必须冻结 base release/ref/hash；所有结果只能写入 U5 Candidate Plane。
- Candidate 分层：物理核心（mandatory）、有签名业务证据的增强项（mandatory enhancement）、未解决增强项（optional/unresolved），不得把无证据推断升级为已验证语义。
- Stable Object ID 必须由 namespace、object role、normalized name、mapping/evidence identity 的 canonical material 确定性派生；不得依赖 Agent 输出顺序或随机 UUID。
- 文档归纳必须保留原始 Evidence Locator，并拒绝 sealed benchmark、Holdout/TEST question、gold answer、expected output、Oracle-derived feedback 或无法证明 workspace/scope 的输入。
- Foundational ontology 只能生成 alignment Candidate，不得直接改写 workspace ontology。
- 漂移维护必须计算受影响闭包，覆盖 metric、formula、query、agent 与 release consumers；未受影响对象的 stable ID 与 content hash 必须保持不变。
- Metric 批量导入必须先完成 dry-run、验证、版本 diff 与冲突报告，再生成 Candidate Patch；支持受控 OSI/Ossie-style exchange projection 到内部 AST，外部字段不得成为发布 Authority。
- `SEMANTIC_INDUCTION` 与 `METRIC_IMPORT` 必须通过 U10 Job Center 的 exact lease/fence/successor 协议执行，支持幂等 replay、取消与稳定错误码。
- PostgreSQL 是 Candidate、Job Receipt、Impact Plan 与 Metric Dry-run Receipt 的 Authority；Contracts 负责 strict schema/canonical hash，Platform 负责窄 RPC，Worker 不得直接 DML。
- Web 只提供 workspace-scoped enqueue/read API；任何 Agent/模型输出都必须在持久化前经过 deterministic validation，且本单元不调用真实 Provider。
- 不导入或运行 Falcon；Falcon 仅作为 U1–U20 全部完成后的最终门禁。

## Acceptance Criteria

- [x] 同一语义对象在输入顺序变化、Agent 提议顺序变化或幂等重放时获得相同 stable ID、proposal hash 与 Candidate digest。
- [x] Schema 归纳和 Document 归纳都产出 review-only Candidate、Evidence、Impact Plan 与 Job Receipt；无任何发布写入。
- [x] 文档证据缺失、越权、sealed benchmark、Holdout/TEST/gold/oracle taint、非法 mapping 均在 Candidate 写入前 fail closed。
- [x] alias 可以确定性合并；跨 package identity 冲突会产生显式 conflict，而不是静默覆盖。
- [x] base release 发生漂移时只重算 affected closure，且机械测试证明 unchanged object hashes 不变。
- [x] Metric dry-run 能报告合法、冲突、无效与版本变化，并且只有成功 dry-run 才能生成 Candidate Patch。
- [x] `SEMANTIC_INDUCTION` 与 `METRIC_IMPORT` 的 enqueue → lease → handler → receipt → successor 链路可机械验证，stale fence/replay/tamper 均被拒绝。
- [x] U5 Candidate Plane 是唯一 Candidate 写入路径；U11 不授予 publish/approve 权限。
- [x] Contracts、Semantic、Platform、Worker、Web 分层测试、类型检查、构建、Biome、SQL renderer/static assertions 与 scoped diff-check 全绿。
- [x] 使用 fresh PostgreSQL 17 时可将 ecommerce/Falcon import hook 指向 `/dev/null` 完成 Authority 断言；不进行数据导入、Falcon 冒烟或真实 Provider 调用。

## Notes

- 对应冻结能力条目 A01–A10，以及 G7/G10/G15/S09。
- U20 负责跨源 bootstrap/orchestration；U11 只实现生成与维护内核，不把 orchestration 偷渡进本单元。
- 当前共享工作树存在大量并行改动；仅 stage U11 owned paths，shared barrel/CLI/static-check 使用精确 hunk。
