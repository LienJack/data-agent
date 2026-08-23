# U12 Resolved Context Package Metric Resolver 能力路由与 Preview

## Goal

在 U2 Effective Config、U5 Published Semantic Release、U11 维护结果与 U15 Knowledge Authority 之上，生成内容寻址、可重放、可预览的 Resolved Context Package。服务端以同一 Resolver 支持 Studio Preview 与真实 Worker，按 Metric → Ontology/Text2SQL → Knowledge → Graph 的受控能力顺序路由，并在容量裁剪后持久化 Authority Receipt。

## Requirements

- Preview 只绑定当前 Workspace Defaults；Run 只绑定 exact Effective Config 与 WORKER_START Context Receipt。PostgreSQL 将两种输入归一成同一 Authority Snapshot。
- Context Package 必须冻结 Published Semantic Release、Schema Snapshot、Context/Egress Policy、Knowledge refs、问题摘要、路由决策、Evidence 摘要与 Context Capacity；不得携带 raw document chunk、query result、prompt、credential 或 private reasoning。
- Metric Resolver 只对 Published Metric 的规范名称或 alias 做确定性 exact phrase 命中；多个命中必须 `NEEDS_CLARIFICATION`，Candidate/Unpublished Metric 永不参与解析。
- 路由优先级固定为 `METRIC`、`ONTOLOGY_TEXT2SQL`、`KNOWLEDGE`、`GRAPH`；不能让相似度或 Provider 输出覆盖优先级与 Authority。
- Context Capacity 采用版本化 UTF-8 byte upper-bound；先保留 Authority/Policy/Mapping，再按稳定优先级裁剪低优先 Evidence，并记录 `MANDATORY/INCLUDED/CROPPED/OMITTED/ON_DEMAND` 原因。
- Package 状态固定为 `READY/PARTIAL/NEEDS_CLARIFICATION/REJECTED/STALE`；只有 READY/PARTIAL 可作为后续 U13/U20 输入，STALE 必须重新解析。
- Preview 与 Worker 对同一 question、Defaults/Effective refs、Provider/Audience projection 生成相同 `package_hash`；各自 Receipt 可因 consumer/request identity 不同而不同。
- PostgreSQL 是 Authority Snapshot 与 Resolved Context Receipt 的持久 Authority；Contracts 负责 strict wire/hash，Semantic 负责纯 Resolver/Router/Capacity，Platform 只使用窄 RPC。
- Web 提供 workspace-scoped preview API 与只读组件；Preview 不创建 Run。U17 后续负责完整交互与“以此配置运行”。
- Worker 在 Provider 调用前解析并持久化 Context Receipt；本单元不新增 Provider 调用、不运行 Falcon、不导入数据。

## Acceptance Criteria

- [x] exact Metric name/alias 只命中 Published projection；同名歧义返回稳定澄清选项，Candidate/Unpublished 不可注入。
- [x] 四级能力路由与降级原因在输入顺序变化后保持相同。
- [x] Context Capacity 先保留 mandatory Authority/Policy/Mapping，机械测试证明裁剪顺序、byte bound 与原因稳定。
- [x] PREVIEW 与 RUN Authority Snapshot 经同一内核生成相同 `package_hash`；篡改 Release/Snapshot/Policy/Knowledge ref 被拒绝。
- [x] PostgreSQL Receipt append-only、FORCE RLS、NOLOGIN owner、exact replay、AppCapability/Worker lease/fence revalidation 全部可验证。
- [x] Worker 在 Provider 调用前持久化 RUN Context Receipt；解析失败时 Provider 调用数为零。
- [x] Preview API 返回状态、route、release/snapshot、证据摘要与裁剪原因，不返回 raw document/query/provider material，也不创建 Run。
- [x] Contracts、Semantic、Platform、Worker、Web scoped 测试/typecheck/build、Biome、renderer/static、fresh PG17 Authority assertions 与 scoped diff-check 全绿。
- [x] fresh PG17 当前 migration chain 不含 ecommerce/Falcon 数据导入 hook，只安装空权威结构；未执行 Falcon 冒烟或真实 Provider。

## Notes

- 对应 R01、R02、R05、R09；R07 只冻结可供 U9 Public Trace 投影的脱敏 Receipt ref，不在 U12 自建第二套 Public Event Ledger。
- U13 消费可查询的 Mapping/Metric；U14/U20 消费 route capability 与 Context ref；U17 扩展 Preview UX。
