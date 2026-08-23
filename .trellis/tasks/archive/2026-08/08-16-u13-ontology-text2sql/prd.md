# U13 Ontology-guided Text2SQL Graph Traversal 与 SQL Firewall

## Goal

让 U12 `READY/PARTIAL` Resolved Context 中的 Published Metric、Ontology 与 Physical Mapping 真正进入确定性 Text2SQL 编译，并用 PostgreSQL Authority、带代际证明的 Neo4j 投影和统一 SQL Firewall 形成不可旁路的只读执行链。

## Requirements

- 只消费 U12 已验证 Package，且状态必须为 `READY/PARTIAL`；request/package/snapshot/release 任一 hash 或 scope 换绑均在编译前失败。
- Grounding 只物化 Published、Queryable、Snapshot-current 的 Metric/Ontology/Physical Mapping；Knowledge-only Concept 可解释但不可生成查询 Mapping。
- Logical Plan 与 SQL 必须包含固定 compiler version、AST hash、mapping closure hash、schema snapshot ref 和 query hash；Provider/LLM 文本不能自签编译权威。
- Graph Traversal 以 PostgreSQL 为 Authority；Neo4j 只返回绑定 exact projection generation/checkpoint 的加速结果，缺失或过期时回退 PostgreSQL并记录原因。
- SQL Firewall 是所有 Text2SQL 执行入口的唯一前置门：只允许单条参数化 PostgreSQL `SELECT/WITH`，限制 relation/column/function/operator/cast、timeout、rows、bytes 与 snapshot。
- Firewall 拒绝是吸收态；RAG、LLM、Graph 或 Worker 不得在拒绝后发起第二条旁路 SQL。
- PostgreSQL Sandbox Authority 在执行前重验 Resolved Context、compiler receipt、datasource/schema snapshot、Attempt/Lease/Fence 与 Firewall decision；成功 Receipt 绑定真实执行结果。
- 本单元不导入或运行 Falcon，不调用真实 Provider，不扩大 U14 MCP 或 U20 Agent 编排范围。

## Acceptance Criteria

- [x] Governed Metric/Queryable Ontology 经 Mapping 编译得到稳定 Logical Plan、SQL、AST/query hash；输入顺序不改变产物。
- [x] Unpublished、无 Mapping、Knowledge-only、跨 Snapshot/Release/Workspace 输入在数据库执行前确定性拒绝。
- [x] PostgreSQL Graph Authority 与 current Neo4j generation 返回一致关系闭包；stale/missing projection 回退 PostgreSQL并签发原因。
- [x] Firewall 拒绝 DDL/DML、多语句、越权 relation/column、危险函数/operator/cast、未参数化业务常量及超限 budget。
- [x] Firewall 拒绝后 datasource execution callback 与任何 fallback SQL 调用数均为零。
- [x] exact Attempt/Lease/Fence/Context/Compiler/Snapshot 换绑全部失败；成功 Receipt 可重放且与真实执行 hash/shape 闭合。
- [x] Contracts、Semantic、Platform focused/full scoped tests、typecheck/build、Biome、renderer/static 与 fresh PG17 U13 assertions 全绿。

## Notes

- 对应 G5/G6/G7、S08/S10、R03/R04/R06。
- U14 消费本单元授权后的 Semantic MCP Tool surface；U20 消费 Context/Compiler/Firewall Receipt，不重复实现安全门。
- 已冻结父计划和用户自动续行指令构成本单元实施批准，不再逐单元询问。
