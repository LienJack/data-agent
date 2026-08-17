# U17 Technical Design

## 1. Boundaries

已归档的 `08-15-workspace-routes-sidebar` 提供 canonical Workspace route、服务端 capability 投影和 Shell。本任务在该基线上增加展示层能力，不改变身份、权限、Run、Semantic、Provider 或 Falcon Authority。

## 2. Typed I18n

`apps/web/src/i18n/messages.ts` 定义 `zh-CN`/`en-US` 完整同构字典和点分隔 message key。`WorkspaceI18nProvider` 仅保存 locale 展示偏好并提供 `t(key)`；切换语言不调用 router，不修改 URL 或业务 Store。Workspace Shell 内的客户端组件消费同一 Provider。

初始 locale 使用稳定 `zh-CN`，客户端挂载后读取 workspace-neutral display preference。偏好不包含业务身份，也不参与服务端鉴权。

## 3. Workspace Chrome

`WorkspaceTopbar` 从已授权 access、pathname 和 search params 派生面包屑。Run/Task/Artifact 查询参数只作为公开资源标识显示，实际页面/API 仍重新校验。Topbar 同时承载语言 segmented control 和 `aria-live` 页面上下文。

Sidebar、StatusBar、ContextPreview、ProcessDisclosure、AgentTeamTrace 全部使用同一翻译函数。Agent 对话继续由 `qa-event-assembler` 将 Public SSE 的 `reasoning` 与 `tool` 转成 ProcessRow；展示层不接受额外私有事件类型。

## 4. Journey And Recovery Model

`apps/web/src/lib/workspace-journey.ts` 保存纯数据状态机：Greenfield 阶段、角色交接、四条正交状态轴和 Reason Code 恢复矩阵。`GreenfieldJourneyPanel` 只渲染传入的服务端 Projection，不自行推断成功，也不生成 Authority Receipt。

动作约束由纯函数计算并可单测。`OUTCOME_UNKNOWN`、Permission、Terminal Policy Denial 和超限状态不会渲染普通 Retry。

## 5. Journey Evidence Contract

`packages/contracts/src/evals/workspace-journey-evidence.ts` 使用 strict Zod schema。构建流程：

1. 校验 scope/workspace/goal、locale、viewport、actor role 和 required checkpoint 集合。
2. 要求每个 required checkpoint 唯一、`PASS`，且携带页面 URL、验证方式、证据引用。
3. 排除 `artifact_hash` 后 canonical SHA-256。
4. 返回 `GO` artifact；任一缺失或失败直接抛错，不生成降级成功。

该 Artifact 是 CI/Goal proof，不是产品 Authority Receipt。U18 只消费验证函数返回的闭包。

## 6. Compatibility And Safety

- Public Run SSE schema、event sequence/cursor 与 durable reconstruction 保持不变。
- i18n 不改业务 payload、hash 或权限判断。
- 所有身份显示仅为公开 ID/hash；禁止 Raw Context、Prompt、SecretRef 和私有推理字段。
- U17 browser journey 使用本地确定性数据和既有开发身份；不调用真实 Provider/Falcon。

## 7. Rollback

移除 Provider/Topbar 与新增展示组件即可回到已提交 Workspace Shell；合同文件为纯新增，无数据库迁移和持久化副作用。
