# U1 能力账本、Greenfield 输入合同与 Bootstrap 基线

## Goal

把冻结计划的 58 个 M/S/A/R/T 能力编号转为严格、机器可验证的合同，并建立 Greenfield Bootstrap、语义覆盖、签名注册表、路由授权和 Falcon 输入隔离基线。

## Requirements

- Capability Manifest 精确覆盖 58 个 ID；每项声明 Owner、Authority、状态、主 U-ID、依赖和非空唯一 Evidence Kinds。
- Evidence Kinds 覆盖 Provider Invocation、非商业 Usage Receipt、Context Capacity、Execution Recovery；M02 同时要求 Invocation 与 Usage Receipt，但不得出现 Billing、Price、Credit、Cost 或 Settlement。
- `GreenfieldBootstrapInput` 只表达空 Workspace 声明、Schema Snapshot、Business Source Bundle、Bootstrap Policy、Mandatory Release Manifest 和首版 Release 目标；U1 仅生成 content-addressed Candidate，真实空库状态由 U5 在 PostgreSQL 事务内核验。
- 历史 Release、Run、File、Payload 或数据迁移引用全部失败关闭。
- `SemanticCoveragePolicyFloor` 要求 in-scope relation/PK/FK/supported queryable column 100% 覆盖；每个 FK 必须有 Join Edge 与 Evidence。
- Falcon Bootstrap Corpus、单题 Public Input 与 Sealed 输入使用互斥判别合同；Gold、Expected、Oracle Feedback、TEST/Holdout 不得进入语义生成。
- `SignerKeyRegistry` 区分 Workspace Admin 与独立 Platform Attestor，记录 key-id、算法、用途、状态和 public material；公钥必须是 canonical Ed25519 主子群点，私钥不得进入合同或 Manifest，Proof-of-Possession 留给 U5 激活流程。
- `RouteAuthorizationMatrix` 固定 Workspace Action、角色、Scope/Ownership、读写、真实 expected version/idempotency、Target state、TaskCapability 与 Audit Event；Principal、Resource existence/ownership 与 TaskCapability 必须由同一个受信 Server Authority Resolver Port 解析。

## Acceptance Criteria

- [x] 58 个能力 ID 各出现且只出现一次，缺失、重复、未知 ID 或依赖环均失败。
- [x] `active_release=null && generation=0` 是两个 Greenfield Candidate 的唯一可接受首发前声明；U5 必须从 PostgreSQL Authority 重验。
- [x] 任一历史引用或 Public/Sealed Falcon 混用均被严格 Schema 拒绝。
- [x] 覆盖策略不能被 Bootstrap Policy 降低，unsupported 类型必须有 Adapter 能力支持的确定性原因。
- [x] 跨角色、跨 Workspace、猜测 ID 与间接 Tool 调用不能绕过同一授权矩阵。
- [x] 调用方自报 Worker、Resource existence/owner 或 TaskCapability 均不能形成可消费的授权事实。
- [x] Route 的不存在/已存在目标状态、真实 version/idempotency 值、Request Hash、Authority freshness 均失败关闭；声明为 `NOT_APPLICABLE` 的字段不能夹带值，`REPLAY_SAME_REQUEST` 只能返回已记录结果而不能再次授权 Effect。
- [x] 合同包公共导出不包含 Mastra 类型、Credential、Bearer Grant 或私钥。
- [x] Composite FK/Join Edge 两端列元数必须一致，2-to-1/1-to-2 关系不能获得 COMPLETE 覆盖结论。
- [x] Focused unit/contract tests、contracts build/typecheck 和根级 Greenfield 集成测试通过。

## Out of Scope

- 数据库 DDL、首版发布 RPC 和真实 Candidate 生成（U4/U5）。
- 历史数据迁移、Backfill、兼容 API 和计费能力。
- Falcon 数据导入。

## Dependencies

无。
