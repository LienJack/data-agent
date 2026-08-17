# U20 Mastra 三类专职 Agent Context Runtime 与 Team 产品接线

## Goal

把 U19 已验证的 Team v2 Authority 接入 Semantic、Resolved Context、Text2SQL、Artifact、MCP/Skill、Report、
Worker 与 Web，物化三个互相隔离的产品 Agent Profile，并让新 Q&A Run 只走 `START_DATA_AGENT_TEAM`。

## Confirmed Baseline

- U19 已完成固定 runtime profile、TaskCapability、64 KiB Context Compiler、depth-1 handoff、Completion/Acceptance、
  Context Epoch recovery、PostgreSQL Team Store 与 execution-only Mastra adapter；U20 不重做这些内核。
- U14 已提供 immutable Skill Registry/Head、Signer revoke、Tool Effect 与 governed MCP transport；U20 只注册/引用
  exact enabled revision，不新增第二套 Skill Authority。
- U9 已提供服务端权威 Resolution Trace/SQL History；Team 产品面只能增加已验签 Profile/Task/Handoff/Verifier 引用，
  不公开 prompt、message、raw context、tool args、Provider body 或私有推理。
- Falcon 仅在 U1-U20 全部完成后运行；U20 不导入数据、不调用真实 Provider/MCP，不进入 Billing/Credit 路径。

## Requirements

1. 新增 framework-neutral `AgentProductProfileRevision/Head/RegistryItem` 合同，冻结 workspace scope、U19 runtime
   profile ref、model config ref、prompt/workflow/tool/context/verifier hash、九个 built-in Skill exact refs 与 canonical hash。
2. 产品 Registry 只允许 `semantic-management-agent`、`governed-text2sql-agent`、`report-writing-agent`；
   Orchestrator 是固定控制角色，不作为可编辑第四个领域 Agent。
3. 新增 `AGENT_PROFILE_MANAGE` workspace action；仅 WORKSPACE_ADMIN/SUPER_ADMIN 可 commit/publish/enable/disable，
   ANALYST/VIEWER 只读已批准 Head。Registry 在同事务复核 actor、CAS version、runtime profile 和 Skill Head。
4. PostgreSQL 10667 使用 immutable Revision + mutable Head + operation receipt、FORCE RLS、NOLOGIN owner、narrow
   SECURITY DEFINER RPC；应用角色无 direct DML，坏 scope/hash/ref/CAS/idempotency 全部失败关闭。
5. 九个内置 Skill 以 canonical bytes/hash、固定 signer、空 install scripts 与 direct-tool subset 注册；三个产品 Profile
   使用互不混淆的 Prompt/Skill/Workflow/Tool/Context/Model/Verifier revision。
6. Workflow 固定为 Semantic `resolve->propose->compile->validate->impact->complete`；Text2SQL
   `resolve_context->plan->compile->firewall->execute->bounded_repair->complete`；Report
   `load_accepted_evidence->claims->charts->citations->validate->complete`。
7. 三个 Tool Catalog 只适配 U5/U7/U9/U11-U14 原子服务；共同元工具限 capability/task/artifact/context/checkpoint/
   complete。每次调用在 adapter 与末端 Authority 双重验证 TaskCapability、profile allowlist 与 current policy/head。
8. 新 Q&A acceptance/lease kind 固定 `START_DATA_AGENT_TEAM`，payload 绑定 Effective Config 与 exact product Profile refs；
   Worker executor registry 对新 kind 只调用 `DataAgentTeamRunner`。旧 `START_L2_RESEARCH` 保留独立显式分支，不 fallback。
9. Team Runner 从 PostgreSQL load/rehydrate root task、Context Epoch、Profile revisions 与 open obligations，使用 U19
   Orchestrator 深度 1 派发三个 specialist；Report evidence gap 最多一次 bounded Text2SQL follow-up。
10. 每个 step/dispatch/tool/handoff/completion 前 checkpoint；Snapshot/KV 丢失从 PostgreSQL 重建，stale Profile/Skill/
    Policy/Release/Fence 拒绝，unknown effect 先 reconcile，不盲重放。
11. Workspace `/agent-profiles` route 返回 strict registry DTO，管理员 mutation 服务端注入 actor/scope/operation ID；
    Team Trace 展示 profile/tool/artifact/handoff/verifier/coverage/checkpoint 与运行上限，不展示敏感正文。
12. 所有 Agent 对话统一使用 durable public Run SSE：公开思考摘要采用 `START/DELTA/END` block，Tool 采用
    `started/completed/failed` call/result 配对；两者在对话与轨迹面均可见且可折叠。禁止接收、持久化或展示 Provider
    `reasoning_content`、raw chain-of-thought、prompt、credential 或未脱敏 Tool body。

## Acceptance Criteria

- [ ] 三个产品 Profile 的 Prompt/Skill/Workflow/Tool/Context/Model/Verifier hash 全部不同且 tamper 失败。
- [ ] Built-in Skill Tool 声明是对应 direct allowlist 子集；缺失/disabled/revoked/hash-mismatch 阻止 Profile READY。
- [ ] Admin commit/list/replay/CAS 与 Analyst/Viewer denial 在 Platform、Route、PostgreSQL 17 全绿。
- [ ] `START_DATA_AGENT_TEAM` Route->Queue->Worker->Team Store->Mastra composition focused slice 通过；绝不落入旧 Research executor。
- [ ] Semantic 不能 publish/query/report，Text2SQL 不能 mutate/report，Report 不能 datasource/query/mutate；共享 read/MCP 旁路同样拒绝。
- [ ] same truth/profile/epoch 重建相同 context/build signature；stale/revoked/unknown-effect 恢复失败关闭且网络调用数为 0。
- [ ] Completion/Verifier/Acceptance 与 U9 Team Trace 引用闭合；空/loading/waiting/terminal/error、桌面/390px 无溢出。
- [ ] Agent SSE 与 DeepSeek Harness 固定事件语义对齐；思考摘要与 Tool call/result 可重放、可折叠，私有推理字段失败关闭。
- [ ] Contracts/Agent Runtime/Platform/Worker/Web focused/full relevant tests、typecheck/build、Biome、renderer/static、
  fresh PostgreSQL 17、forbidden scan 与 Trellis check 通过；只提交 U20 owned hunks。

## Out of Scope

- 不修改 U19 Team Scheduler/Capability/Epoch/Acceptance 基本语义，不引入递归 Agent Network 或共享 Memory。
- 不执行 U16 Datasource Gallery、U17 完整 Workspace Journey 或 U18 Falcon Gate。
- 不调用真实 Provider/MCP，不新增定价、计费、Credits、Quota 或商业预算 UI。
- 不迁移/回填历史 Run/Profile，也不把旧 `START_L2_RESEARCH` 自动解释为 Team Run。
- Falcon 后的全站逐页重设计属于最终验收后的独立阶段，必须使用 `design-taste-frontend`，覆盖布局、信息密度、
  展示方式与桌面/移动端浏览器验证。

## Notes

- 对应 G3/G6/G7/G9/G13/G14/G16、M05/M12/M13、R03/R06/R08、T01-T07。
- Blocking Questions 为空；用户已冻结自动推进与中间不运行 Falcon/真实 Provider。
- SSE 语义参考 DeepSeek Harness 固定提交 `47f943859bef60e4160492346772ded9b24f765a`；仅借鉴 durable
  `reasoning-delta`、`text-delta`、`tool/call -> tool/result` 结构，不复制其私有推理字段。
