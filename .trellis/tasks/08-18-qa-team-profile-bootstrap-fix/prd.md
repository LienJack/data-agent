# 修复本地 Team Profile 初始化与 Q&A 错误诊断

## Goal

让显式完成本地/demo 初始化的工作空间可以从 Q&A Composer 成功创建
`START_DATA_AGENT_TEAM` Run，并在任何准入失败时向用户展示服务端稳定错误码与可执行消息，
而不是只有笼统的 `API 请求失败 (400)`。

## Background

- 2026-08-18 在工作空间 `908daa22-1bb5-4029-a616-22d0dece1c0b` 复现：
  `POST /api/workspaces/:workspaceId/qa/conversations/:conversationId/runs` 返回
  `AGENT_PROFILE_SET_NOT_READY`。
- `apps/web/src/app/api/workspaces/[workspaceId]/qa/conversations/[conversationId]/runs/route.ts:104`
  要求三个 enabled Product Profile 精确齐备后才接受 Run。
- 当前本地数据库没有 `agent_product_profile_heads`、`workspace_run_defaults` 或物理
  Schema Snapshot；只补 Profile 会依次暴露 `WORKSPACE_DEFAULTS_NOT_CONFIGURED` 和
  `SCHEMA_SNAPSHOT_STALE`。
- 当前工作空间已有 ACTIVE E-commerce datasource、PUBLISHED semantic release、DeepSeek/Kimi
  authenticated system model，具备完成显式 readiness bootstrap 的输入。
- `apps/worker/src/teams/materialize-builtin-team.ts:21` 已提供先提交九个 Skill、再提交三个
  Product Profile 的权威 helper，但目前没有本地/demo 调用方。
- `apps/web/src/lib/api-client.ts:65` 丢弃非 2xx JSON body，只拼接 HTTP status。

## Requirements

1. 新增显式 opt-in、可重复执行的本地/demo Q&A readiness bootstrap；未提供精确确认变量时不写数据，
   production 环境必须拒绝运行。
2. Bootstrap 必须通过现有 Authority/Port/RPC 完成 Schema Discovery、Workspace Defaults、
   Skill Registry、Product Profile Registry 和所需模型资源配置；禁止直接写 Product Profile/Skill 表，
   禁止绕过 RLS、CAS、hash、approval、signer 或 lifecycle 校验。
3. Bootstrap 必须以 workspace/deployment/principal scope 运行，生成稳定幂等 identity；重复执行不得创建
   重复 Head、Defaults revision 或相互冲突的 receipts。
4. 三个 Product Profile 保持 U20 的互相隔离合同。若本地只有少于三个用户可选模型，bootstrap 使用
   稳定、角色专属、由已认证系统模型派生的实际 Model Profile revision，不降低生产 Profile 校验。
5. Bootstrap 成功后，目标 workspace 必须具有：成功物理 Schema Snapshot、绑定当前 datasource/model/
   semantic release/snapshot/builtin policies 的 Workspace Defaults、九个 enabled Skill Heads，以及三个
   approved+enabled Product Profile Heads。
6. 通用 Web API client 必须安全解析标准 `{ error: { code, message, retryable } }`，优先显示服务端消息并保留
   error code；非 JSON 或非标准错误仍回退到 HTTP status，且不得泄露响应体或 secret。
7. 现有生产 fail-closed 行为保持不变：未初始化 workspace 继续被拒绝，不自动 fallback 到
   `START_L2_RESEARCH`，不在 Q&A POST 内隐式 bootstrap。
8. 为 bootstrap 幂等/失败关闭、fresh-readiness 到 Run acceptance、以及客户端错误投影补回归测试。

## Acceptance Criteria

- [ ] 未设置确认变量、环境为 production、authority/scope/resource 不完整时，bootstrap 输出稳定 HOLD/
      NOT_RUN reason code，且数据库无部分 Profile/Defaults 激活。
- [ ] 对已具备 E-commerce datasource、semantic release 和 authenticated model 的本地 workspace 执行一次
      bootstrap 后，三个 Product Profiles 以规范顺序从 `enabled_only=true` 列出。
- [ ] 同一输入连续执行 bootstrap 两次，第二次返回 ALREADY_READY/REPLAYED 等稳定成功结果，Head 数量、
      active revision 与 Defaults revision 不增长。
- [ ] Bootstrap 后同一 Q&A 请求不再返回 `AGENT_PROFILE_SET_NOT_READY`、
      `WORKSPACE_DEFAULTS_NOT_CONFIGURED` 或 `SCHEMA_SNAPSHOT_STALE`，并成功创建 Team Run。
- [ ] 服务端返回标准错误时，Q&A 错误消息显示真实 `message` 与 `code`；非 JSON 500 仍显示安全 status fallback。
- [ ] 相关 contracts/platform/worker/web focused tests、typecheck、Biome 和浏览器复现验证通过。
- [ ] 仅提交本任务拥有的文件和 hunk，不包含当前工作区其他未提交修改。

## Out of Scope

- 不对已有生产 workspace 做迁移或自动回填。
- 不在 `pnpm dev`、页面加载或 Run POST 中加入隐式持久化副作用。
- 不降低三 Profile、九 Skill、Schema Snapshot、Defaults、Provider authentication 或 Team acceptance 门禁。
- 不把新 Team Run 回退为旧 `START_L2_RESEARCH`。
- 不重做 Q&A 页面视觉设计或完整 Worker/Falcon 能力优化。

## Technical Notes

- 入口采用独立显式 CLI，避免修改已存在且有用户未提交改动的本地 runtime/bootstrap 链。
- 当前工作空间的首个阻断是 Profile，后续 Defaults/Snapshot 缺口已通过只读数据库查询确认；验收必须覆盖
  完整 readiness 链，不能只断言首个 400 消失。
