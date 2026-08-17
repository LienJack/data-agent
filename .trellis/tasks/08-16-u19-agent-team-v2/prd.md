# U19 Agent Team v2 合同与早期纵向切片

## Goal

在 U8–U15 大规模接线之前，用固定版本 Mastra、真实 Artifact Reference 与 PostgreSQL Authority 证明三类专职 Agent Profile、确定性 Context Compiler、深度 1 Subagent 委派/回收、Handoff CAS、Completion/Acceptance 分离及 Context Epoch 中断恢复可行。U19 只验证团队运行时合同，不冒充 U20 的完整产品 Tool 接线。

## Confirmed Baseline

- 现有 `packages/agent-runtime/src/teams` 是 v1 进程内合同，只能生成 `NON_AUTHORITATIVE_RUNTIME/PREPARED` Handoff；它没有持久 Task/Attempt/Fence/Epoch/Acceptance Authority。
- U2/U3 已冻结 Effective Config、Worker lease/fence、Provider Dispatch/Response/Usage Authority；U19 必须引用它们，不能新建第二套 Run Queue、Provider Store 或调用方自报的授权事实。
- U7 已提供完整、内容寻址的 Artifact Reference/Preview/Export；U19 Context、Handoff 与 Result 只携带 exact Artifact references，敏感执行内容默认没有 Public Preview。
- PostgreSQL 是 Task/Event/Artifact/Effect/Lease/Fence/ContextEpoch/OpenObligation/Acceptance 唯一权威；Mastra Snapshot 仅为 `EXECUTION_SNAPSHOT_ONLY`，不能成为业务状态真相。
- Falcon 已导入，但只在 U1–U20 全部完成后作为最终门禁。本单元不导入数据、不运行 Falcon、不调用真实 Provider，也不进入 Billing/Pricing/Credit 路径。

## Requirements

1. 定义框架无关的 Team v2 合同：`data-agent-orchestrator` 控制角色和 `semantic-management-agent`、`governed-text2sql-agent`、`report-writing-agent` 三个固定 Profile；每个 `AgentProfileRevision` 冻结 direct tools、delegation ceiling、mandatory context、expected outputs 与 verifier contract。
2. Orchestrator 的 direct tool allowlist 为空，只能通过持久 Orchestration Authority 创建深度 1 子 Task；子 Agent 没有递归 delegation 权，也不能通过共享 read/job/MCP/组合服务绕过 direct tool policy。
3. 每个 Task 使用短期 `TaskCapability`，精确绑定 profile revision、task/attempt/fence、完整 App scope、run、artifact set、audience、issuer/key id、nonce、revocation version 与 expiry。只有持有 `TASK_CAPABILITY_ISSUE` 的非 Agent 服务可以签发；Agent、客户端、Mastra snapshot 或共享 Worker 身份都不能自签。
4. `ContextCompiler` 仅从 Goal/Task revision、Event watermark、Policy、Semantic Release 与 committed Artifact truth 构建 Model View，并生成 `ContextBuildManifest`、`BuildSignature`、`ProjectionCoverageReceipt`、`OmissionLedger` 与 `ContextEpochRef`。相同输入重建结果相同；dispatch 前任何 truth drift 都必须在网络前失败关闭。
5. Context projection 最大 64 KiB，所有内容都标记 `UNTRUSTED_DATA/DATA_ONLY`。Mandatory context 的候选全集、纳入、遗漏、裁剪原因与按需 ref 必须完整可审计；Policy、Question、Mapping 或 Claim Evidence 的关键遗漏阻止 Acceptance。
6. 在所有 Mastra middleware/processor 之后、Provider transport 之前，对最终 messages/tool schemas/attachments/profile/model revision/projection ref 与 U3 ceilings/token bound 生成 `ProviderDispatchEnvelope`。最终 wire 与 manifest/projection 不一致时 Provider 调用数必须为 0。
7. `DelegationContract` 只创建 fresh、深度 1 子 Task；只传最小 Context Slice/Artifact refs/Capability/容量/安全界限/Acceptance contract。父完整历史、secret、system prompt、raw memory 与无关 artifact 不进入子 Task。
8. Handoff 必须使用 parent task expected revision、active attempt/fence 与 lineage CAS。cancel、timeout、lease expiry、stale profile/fence、provider child id 冒充与 late result 均保留审计，但不能进入父 Accepted set。
9. `complete_task` 只提交 typed output 与 committed Artifact refs。`VerifierDecision` 独立记录 schema/scope/policy/provenance/execution/intent/oracle 七个维度；`TaskCompletionReceipt` 不等于 `TaskAcceptanceReceipt`。无法证明语义正确时只能是 `SEMANTICALLY_UNVERIFIED` 或 `NEEDS_CLARIFICATION`。
10. Context compaction 使用 `start -> summary -> replace -> end -> probe`，新 Epoch 激活前必须与 PostgreSQL `OpenObligationLedger` 做 ID/状态集合等价比较。旧 Epoch 在整个切换中保持 active；pending/unknown effects 必须先 reconcile，禁止盲重放。
11. 新 `SensitiveExecutionArtifact` 合同覆盖 Context Slice/Model View/Compaction/Omission/Obligation/Handoff/Recovery 内容。加密 payload 由私有内容寻址 blob port 保存；PostgreSQL 只保存 scope/task/epoch、key id、cipher/plain hash、TTL、legal hold、refcount、tombstone、backup expiry 与访问审计。密钥只以 SecretRef/KMS 在服务端解引用，默认无 Public Preview。
12. PostgreSQL 10658 新增最小 Team Authority，不创建第二 Run Queue。所有写入精确绑定 U4 active RunWorkLease 与 U2/U3 context/config refs，使用 FORCE RLS、NOLOGIN owner、immutable/append-only guards、narrow SECURITY DEFINER RPC 与稳定错误码。
13. 早期 slice 在 fake/no-network transport 下跑通 `Text2SQL -> Verifier -> Report` 与 `Semantic -> Candidate`；Candidate 不可被正式 Text2SQL/Falcon 消费，Report 不能把未验证内容升级为事实。
14. 公共 `@data-agent/agent-runtime` 根不导出 Mastra Agent/Thread/Memory/Snapshot 构造器或类型；运行时 adapter 只接受 framework-neutral ports，并从 PostgreSQL truth rehydrate。
15. Intent/Trace/Receipt/Public projection 与日志禁止保存 raw prompt/response/messages/tool args/headers/credentials/SecretRef values/sealed context/cross-workspace canary；错误只返回稳定码和安全信息。

## Acceptance Criteria

- [x] 三个固定 Profile 的 direct tools、delegation ceiling、mandatory context、workflow、expected output 与 verifier contract 均不同且 schema/hash tamper 失败；Orchestrator 可委派但不能直接调用领域 Tool。
- [x] 100 个 Task 的每个 context projection 不超过 64 KiB；coverage/omission 完整，关键遗漏使 Acceptance 失败。
- [x] 清空进程 Memory/View cache 后，从同一 PostgreSQL truth 重建相同 Build Signature；Goal/Policy/Release/Event watermark 漂移时 provider dispatch 为 0。
- [x] Mastra middleware 后置追加 message/attachment/tool schema 或篡改 ceilings 时 dispatch envelope 校验失败且网络为 0。
- [x] fresh child 不含父 secret/history；递归 spawn、scope/artifact/tool/network/capacity 扩权、过期 capability、stale fence/profile 与 provider child ID spoof 全部失败关闭。
- [x] Handoff exact replay 返回同 receipt；同 expected revision 修改请求冲突；late result 被审计但不被接受。
- [x] Completion 与 Acceptance 分离；七维 verifier 未全部满足时不能生成 Accepted receipt；Report 不升级未验证 Claim。
- [x] 在 compaction start/summary/replace/end/probe 各 kill point 可恢复；obligation 集合不等价时新 Epoch 不激活，旧 Epoch 仍可用；unknown effect 不盲重放。
- [x] Sensitive artifact 的 plaintext/cipher hash、scope、TTL/legal hold/refcount/tombstone/backup expiry 与访问审计闭合；跨 workspace、过期、删除后读取、backup 到期和 public preview 均失败。
- [x] 10658 的 RLS/NOLOGIN/grants/append-only/FK/CAS/lease-fence/hash assertions 与 fresh PostgreSQL 17 全绿；应用角色无 direct DML。
- [x] Contracts/Agent Runtime/Platform focused/full tests、typecheck/build、renderer/static、Biome、diff-check、forbidden scan 与 Trellis check 全绿。
- [x] 一个 scoped commit 只包含 U19 owned paths；无数据导入、Falcon smoke/评分、真实 Provider、Claude/Anthropic、compound-engineering/`ce-*` 或商业计费改动。

## Out of Scope

- U20 完整 Agent 产品接线、真实领域 Tool/MCP/Skill/Workflow registry 与 UI。
- U8–U15 的完整 Run/Semantic/Text2SQL/Report 业务实现，以及 U18 Falcon 最终门禁。
- 新 Provider、模型认证、Pricing/Billing/Credit、对象存储供应商 SDK 或真实 KMS 调用。
- 兼容迁移、历史数据 backfill、第二次 Falcon/ecommerce 导入或用 in-memory store 代替发布门禁。

## Dependencies

- U2 Effective Config/Context Receipt/Conversation/Run acceptance。
- U3 Provider Invocation/Projection/Response/Usage Authority。
- U5 Semantic bootstrap release Authority。
- U7 committed Artifact Reference/Preview/Export identity。
