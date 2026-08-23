# 问答编排器模型与数据源切换

## Goal

把问答页底部输入区改造成一个清晰、克制、可操作的消息编排器，并让用户选择整个对话使用的
模型和数据库源。视觉语言参考 DeepSeek Harness 的一体化 Composer，但保留 Data Agent 现有组件、
领域概念、Authority、计费和执行数据流。

目标页面是 canonical workspace 分析路由：

```text
/w/:workspaceId/qa
```

## Confirmed Product Decision

- 模型和数据源都按对话冻结。
- 空对话可以直接更新资源绑定。
- 对话已有消息后，切换模型或数据源会创建并激活一个新的空对话；旧对话、旧消息和旧 Run
  保持不变，不能把不同数据库的证据混在同一条对话链中。
- 新对话只继承可识别标题，不复制旧消息或隐藏上下文。

## Background

- 用户提供的当前截图显示：输入区由锐利边框文本框、独立模型下拉和圆形发送按钮组成，视觉层级
  松散，数据源还位于页面顶部的另一条资源栏。
- DeepSeek Harness 参考图把输入、上下文、模型和发送动作放进同一大圆角容器，层级更集中。
- `apps/web/src/app/w/[workspaceId]/qa/page.tsx` 当前复用 `apps/web/src/app/qa/page.tsx`，后者直接
  组合 `ChatArea + ChatInput + TrajectoryView`；本任务修改的就是该 workspace 分析页组件链。
- 当前 `chat-input.tsx` 只渲染模型选择器，`chat-area.tsx` 单独渲染数据源选择器。
- 当前模型选择只写入 `qa_conversations.model_id`；`createRun`、Run Command、Lease 和 Worker 都
  没有携带或消费该选择。
- 当前数据源会写入 `workspace_run_bindings`，但通用 Worker 的
  `research-workflow-executor.ts` 仍构造固定零值演示输入，没有读取该数据源执行查询。
- 因此本任务必须同时完成视觉改造、对话资源冻结、Run 不可变绑定和真实 Worker 执行；只移动
  下拉框或保存前端状态不算完成。

## Requirements

- R1：输入、资源选择和发送/停止动作位于同一个 Composer 容器，参考 DeepSeek Harness 的结构，
  但不复制其品牌、Workspace Write 或 steer 语义。
- R2：保留多行输入、`Enter` 发送、`Shift+Enter` 换行、输入法组合态、空输入不可发送和运行中
  停止。
- R3：模型选择器只列出当前部署中可识别、可授权且具备运行前置条件的模型；选择使用稳定
  `model_profile_id`，不能把展示名称当执行标识。
- R4：数据源选择器只列出当前工作空间可访问且状态为 ACTIVE 的数据源，并显示名称、类型和连接
  状态。
- R5：模型与数据源共同构成对话资源绑定；首次发送前必须完整，首次消息写入后服务端拒绝原地
  修改任一资源。
- R6：已有消息时切换任一资源，服务端必须在同一 Authority 边界创建新对话并返回明确结果；
  前端激活新对话并保留旧对话可访问。
- R7：创建 Run 时服务端从对话读取资源绑定并冻结到 Run；浏览器不能通过重复提交资源 ID 覆盖
  对话绑定。
- R8：所选模型必须进入 Worker 的 Profile/Provider、Credential、Certification、Billing 和实际
  Provider 调用链；测试必须证明不同 Profile 产生不同运行绑定和 Provider 调用。
- R9：所选数据源必须进入 Worker 的 Datasource/SecretRef/Egress、语义上下文和 SQL Sandbox
  执行链；所有 schema/query/tool 调用只能使用该 Run 冻结的数据源。
- R10：模型、数据源和资源切换需要完整的 loading、empty、error、disabled、selected、switching
  状态；不可运行选项不能伪装为可用。
- R11：选择器、文本框和发送/停止按钮支持键盘操作、可访问名称、焦点态和窄屏布局，不产生横向
  滚动。
- R12：公开响应和事件不得包含 Credential、SecretRef 明文、连接串、内部 Prompt、私有推理或
  Raw Memory。

## Acceptance Criteria

- [ ] AC1：`/w/:workspaceId/qa` 分析页展示统一的大圆角 Composer；输入区和底部工具条属于同一
  视觉容器，数据源在左，模型与发送/停止动作在右，页面顶部不再重复资源选择栏。
- [ ] AC2：刷新或重新进入页面后，从服务端对话投影恢复已冻结的模型和数据源；没有完整资源绑定时
  发送按钮保持禁用并说明缺失项。
- [ ] AC3：空对话切换资源原地更新；有消息对话切换资源返回新 `conversation_id`、激活新空对话，
  且旧消息、旧 Run binding 和旧轨迹完全不变。
- [ ] AC4：首次消息后，绕过 UI 直接修改对话模型或数据源会被 PostgreSQL/Repository 稳定拒绝。
- [ ] AC5：Run 创建请求只携带问题、对话和幂等键；服务端冻结
  `datasource_id + model_profile_id + model_config_version`，客户端不能制造资源不一致。
- [ ] AC6：选择两个不同模型创建对话并运行时，Worker/Provider 观察到相应的 Profile/Provider
  绑定，账务 invocation 与 Run principal、模型快照一致。
- [ ] AC7：选择两个不同数据源创建对话并运行时，schema lookup、SQL 计划和 Sandbox authority
  只接收各自的 `datasource_id`；跨源引用失败关闭。
- [ ] AC8：模型或数据源加载失败时提供内联错误和重试；列表为空时提供配置入口说明，不能静默回退
  到未知资源。
- [ ] AC9：`Enter`、`Shift+Enter`、IME composition、空输入、运行中停止、资源切换确认和失败恢复
  通过组件或浏览器测试。
- [ ] AC10：桌面和窄屏无横向溢出，弹层不会被 Composer/viewport 裁切，所有核心动作可通过键盘
  访问并有可访问名称。
- [ ] AC11：相关 Contract、Platform、Worker、Web、PostgreSQL 和浏览器验证通过，并形成只包含本
  任务文件的 scoped commit。

## Out of Scope

- 新增或编辑模型配置、供应商密钥、数据库连接凭据；本任务只消费现有 Authority 投影。
- 同一对话多模型路由、自动 fallback、多数据源 join 或跨数据源上下文共享。
- 复制 DeepSeek Harness 的 Workspace Write 权限、队列 steer、品牌资产或私有推理展示。
- 重做完整消息列表、Trajectory Inspector、报告编辑器、模型管理页或数据源管理页。
- 放宽现有 RBAC、Billing、Certification、Semantic、Egress 或 Sandbox 门禁。

## Notes

- 这是跨 Composer、Conversation Contract、PostgreSQL、Run API、Worker/Provider、Datasource 和
  Billing 的垂直任务，必须使用 `design.md` 与 `implement.md`。
- 当前工作树中相关 Q&A、Store、Contracts 和 Platform 文件已有并行修改；实施前必须逐文件确认
  所有权，逐 hunk 暂存，无法安全分离时停止并报告 commit blocker。
