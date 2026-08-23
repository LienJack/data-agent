# DataFoundry 平台模块 — 实现计划

## 父任务

本任务为父任务，包含四个子阶段，每个阶段独立可验证。

## 阶段 1: 布局改造 + Data Link (U1, U2, U3)

### 2026-08-06 主分析工作台业务化调整
- [x] 参考截图的浅色三栏信息组织，不复制产品身份与虚构模块
- [x] 左栏按归因分析、数据语义和治理业务组织，最近分析来自真实 store，能力状态来自 Workbench authority
- [x] 中栏以审计文档形式渲染当前 `RunProjection` 的报告、声明证据与验证路径
- [x] 右栏从同一投影派生业务范围、有限假设、门控回执、SQL 执行、报告候选与治理交付，不伪造 Trace DAG
- [x] 底部固定数据问题输入区，支持 Enter 提交
- [x] 浏览器验证侧栏折叠、Console 标签切换、Console 关闭/重开和 Q&A 单侧栏路由
- [x] `pnpm --filter @data-agent/web typecheck`
- [x] 受影响文件 `biome check`
- [x] `pnpm --filter @data-agent/web build`（退出码 0；保留既有 `libpg-query.wasm` `/ROOT` 路径告警）

### U1. 侧边栏布局改造
- [ ] 更新 `app-shell.tsx`：从 NavBar 切换为 Sidebar 布局
- [ ] 验证：所有页面在侧边栏布局下正常渲染

### U2. Data Link 语义模型浏览器
- [ ] 创建 `data-link/page.tsx` — 模型列表页面
- [ ] 创建 `data-link/models/[id]/page.tsx` — 模型详情页面
- [ ] 创建 `components/data-link/model-list.tsx`
- [ ] 创建 `components/data-link/model-detail.tsx`
- [ ] 创建 `lib/data-link-store.ts` (zustand store)
- [ ] 验证：导航到 /data-link 可看到语义模型列表，点击模型进入详情页

### U3. Data Link 语义编辑器
- [ ] 创建 `data-link/editor/page.tsx` — 新建语义
- [ ] 创建 `data-link/editor/[id]/page.tsx` — 编辑已有语义
- [ ] 创建 `components/data-link/semantic-editor.tsx`
- [ ] 验证：编辑语义后可提交审核，跳转到审核页面

## 阶段 2: Data Sources (U4, U5)

### U4. Data Sources API
- [ ] 创建 `api/datasources/route.ts` (GET, POST)
- [ ] 创建 `api/datasources/[id]/route.ts` (DELETE)
- [ ] 创建 `api/datasources/test/route.ts` (POST 测试连接)
- [ ] 创建 `lib/datasource-types.ts`
- [ ] 创建 `lib/datasource-api.ts`
- [ ] 验证：API 可正常创建、查询、删除数据源连接

### U5. Data Sources 页面
- [ ] 创建 `data-sources/page.tsx`
- [ ] 创建 `components/data-sources/connection-list.tsx`
- [ ] 创建 `components/data-sources/connection-form.tsx`
- [ ] 创建 `lib/datasource-store.ts` (zustand store)
- [ ] 验证：用户可完成从创建连接到测试连接到保存的完整流程

## 阶段 3: Agent Q&A (U6, U7, U8)

### U6. Q&A 对话布局
- [ ] 创建 `qa/page.tsx`
- [ ] 创建 `components/qa/conversation-list.tsx`
- [ ] 创建 `components/qa/chat-area.tsx`
- [ ] 创建 `components/qa/chat-input.tsx`
- [ ] 创建 `components/qa/data-source-selector.tsx`
- [ ] 创建 `components/qa/model-selector.tsx`
- [ ] 创建 `lib/qa-store.ts` (zustand store)
- [ ] 验证：Q&A 页面布局正确，选择器可正常使用

### U7. Q&A 消息系统
- [ ] 创建 `components/qa/chat-message.tsx`
- [ ] 创建 `components/qa/result-card.tsx`
- [ ] 创建 `components/qa/loading-indicator.tsx`
- [ ] 验证：用户可在 Q&A 中提问并看到 Agent 返回结果

### U8. Q&A 对话持久化
- [ ] 创建 `api/qa/conversations/route.ts`
- [ ] 创建 `api/qa/conversations/[id]/route.ts`
- [ ] 创建 `api/qa/conversations/[id]/messages/route.ts`
- [ ] 验证：对话历史持久化，刷新页面后可恢复

## 阶段 4: Model Settings + Q&A 模型切换 (U9, U10, U11)

### U9. Model Settings API
- [ ] 更新 `lib/model-types.ts`：增加 provider、modelName、active、connected 字段
- [ ] 创建 `lib/model-provider-presets.ts`：OpenAI/Anthropic/DeepSeek/GLM/Kimi/Grok/Gemini 默认配置
- [ ] 更新 `api/models/route.ts`：创建/列表支持 provider 模型 profile
- [ ] 更新 `api/models/[id]/route.ts`：支持 DELETE/PATCH、设为默认
- [ ] 创建 `api/models/test/route.ts`：测试连接
- [ ] 将内存 Map 替换为 PostgreSQL 持久化（或至少复用平台 secret-ref 模式）
- [ ] 更新 `lib/model-api.ts`：增加 testModel、updateModel、setActiveModel
- [ ] 验证：API 可管理多 provider 模型 profile，测试连接可返回成功/失败

### U10. Model Settings 页面
- [ ] 更新 `settings/page.tsx`：支持多 provider 模型 profile 管理
- [ ] 更新 `components/settings/model-config-list.tsx`：显示 provider、model、连接状态、默认标记
- [ ] 更新 `components/settings/model-config-form.tsx`：provider 选择、自动填充默认值、测试连接、设为默认
- [ ] 更新 `lib/settings-store.ts`：支持加载/创建/更新/删除/设为默认
- [ ] 验证：用户可完成多 provider 模型配置的添加、测试、默认设置和管理，配置后的模型出现在 Q&A 选择器中

### U11. Q&A 模型切换接入 run
- [ ] 更新 `lib/api-client.ts`：`createRun` 支持传入 `modelId`
- [ ] 更新 `lib/qa-store.ts`：保存当前对话 `modelId`，发送消息时传入 `createRun`
- [ ] 更新 `components/qa/model-selector.tsx`：选择后更新 QA store 和 conversation modelId
- [ ] 更新 `api/qa/conversations/route.ts` 和 `[id]/route.ts`：创建/更新对话时保存 modelId
- [ ] 创建 `api/runs/route.ts`（如外部 `/api/v1/runs` 不接收 modelId）：代理并在 run 请求中注入模型 profile
- [ ] 如 run 后端由本仓库 worker 控制，更新 `apps/worker/src/runs/run-execution-context.ts` 或其他 run 输入解析，使 run 读取模型 profile
- [ ] 验证：Q&A 选择不同模型后 run 实际使用对应 provider/model，刷新对话后选择器状态可恢复
