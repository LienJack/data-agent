# 工作空间路由与侧栏统一：技术设计

## 1. Architecture and Boundaries

### 1.1 Canonical route ownership

业务 UI 继续复用现有页面实现，避免复制 Run、QA、Test Center、Data Source、Data Link 与 Semantic 逻辑；URL 入口分为三类：

| 类型 | 路由 | 行为 |
| --- | --- | --- |
| 身份入口 | `/login`、`/workspaces` | 不显示工作空间业务侧栏 |
| 工作空间业务入口 | `/w/:workspaceId/**` | 由工作空间服务端布局鉴权并显示统一左侧栏 |
| 旧全局业务入口 | `/`、`/qa`、`/tests`、`/data-sources`、`/data-link/**`、`/semantic/**`、`/settings` | 307 跳转 `/workspaces`，不推断工作空间 |
| 平台管理入口 | `/admin/**` | 保持平台级语义，不强制绑定单一工作空间 |

旧 URL 重定向放在 `apps/web/next.config.mjs`，因此工作空间页面仍可复用旧页面模块；重定向只匹配请求 URL，不影响模块导入。使用临时重定向便于灰度和回滚，也避免浏览器永久缓存尚在演进的入口策略。

### 1.2 Workspace shell

`apps/web/src/app/w/[workspaceId]/layout.tsx` 保持唯一的服务端权限边界：

1. 解析登录会话。
2. 读取当前用户可访问工作空间。
3. 对 URL 中 `workspaceId` 解析服务端 capability。
4. 找不到访问投影时跳转 `/workspaces`。
5. 把已经验证的 `WorkspaceAccessProjection` 与过滤后的导航投影传给客户端 `WorkspaceShell`。

`WorkspaceShell` 负责视觉外壳：左侧 `Sidebar`、主内容、必要时的 `StatusBar`。现有工作空间顶部业务导航删除，避免同一导航维护两套链接。`AppShell` 继续跳过 `/w/*`，从而不会形成双层外壳。

### 1.3 Single navigation source

`apps/web/src/lib/workspace-navigation.ts` 成为工作空间业务导航的唯一来源。每个定义包含稳定 key、标签、说明、路径、所需 `WorkspaceAction` 和交付阶段；`navigationForWorkspace(access)` 只输出服务端 `allowed_actions` 允许的条目。

规范导航顺序：

1. 归因分析 → `analysis` → `ANALYSIS_RUN_CREATE`
2. 对话分析 → `qa` → `ANALYSIS_RUN_CREATE`
3. 能力测试 → `tests` → `WORKSPACE_RESULT_READ`
4. 数据源 → `data-sources` → `DATASOURCE_MANAGE`
5. 数据语义 → `data-link` → `SEMANTIC_EDIT`
6. 语义治理 → `semantic` → `SEMANTIC_EDIT`
7. 成员管理 → `members` → `MEMBER_MANAGE`
8. 模型配置 → `platform-settings` → `MODEL_MANAGE`

Sidebar 使用该导航投影匹配图标、当前项和快捷入口，不再维护全局 `navItems` 常量。Workspace Home 的卡片也继续消费同一投影。

## 2. Route Map

新增或规范化以下工作空间页面：

| 规范路由 | UI 来源 |
| --- | --- |
| `/w/:workspaceId/analysis` | 现有归因分析页 |
| `/w/:workspaceId/qa` | 现有 QA 页 |
| `/w/:workspaceId/tests` | 现有 Test Center 页 |
| `/w/:workspaceId/data-sources` | 现有数据源页 |
| `/w/:workspaceId/data-link` | 现有 Data Link 列表 |
| `/w/:workspaceId/data-link/editor` | 现有新建语义模型页 |
| `/w/:workspaceId/data-link/editor/:id` | 现有语义模型编辑页 |
| `/w/:workspaceId/data-link/models/:id` | 现有语义模型详情页 |
| `/w/:workspaceId/semantic` | 现有语义治理页 |
| `/w/:workspaceId/semantic/explorer` | 现有 Semantic Explorer |
| `/w/:workspaceId/semantic/physical-schema` | 现有 Physical Schema |
| `/w/:workspaceId/members` | 现有成员管理页 |
| `/w/:workspaceId/platform-settings` | 现有设置页 |

`/w/:workspaceId/results` 在服务端重定向到 `/w/:workspaceId/tests`，保留已有书签兼容但不继续作为导航入口。

## 3. Workspace Context Contract

- `workspaceId` 的客户端来源仅允许当前 `/w/:workspaceId` URL；`resolveWorkspaceId()` 删除 `sessionStorage` 写入和回退。
- API 路径和 `x-workspace-id` 继续从同一个已解析 ID 生成；服务端仍核对 URL、请求头、会话和 capability。
- 切换入口使用 `/workspaces`，不携带最近工作空间。选择新工作空间后由规范 URL 建立新上下文。
- 工作空间 shell 的 `workspaceId` 变化时，重置 QA、Workbench、Data Source、Data Link 与 Semantic 等工作空间客户端状态，防止 Zustand 模块状态跨工作空间残留；布局折叠状态可以保留，因为它不含业务数据。
- 异步请求完成前若工作空间已变化，不得把旧工作空间结果写回新工作空间视图。优先通过工作空间绑定/请求代次检查实现，必要时在切换时中止请求。

## 4. Internal Navigation

建立一个纯函数工作空间路径构造器，统一生成 `/w/${workspaceId}/${path}`。SideBar 与以下硬编码入口改用该构造器或当前导航投影：

- 新建业务问题与最近会话跳转。
- 当前分析链接。
- Data Link 列表、详情、编辑返回路径。
- Semantic Editor 提交后的审核路径。
- Semantic Explorer 的返回链接与 URL 查询参数更新。

路径构造器负责去除多余斜杠并编码工作空间 ID；调用者不得自行拼接另一个隐式工作空间来源。

## 5. Compatibility and Migration

- 不移动或复制旧页面的大段业务实现；工作空间 route wrapper 继续复用它们。
- Next.js 配置级 307 重定向先封闭旧入口，再补齐所有工作空间 route wrapper。
- `/workspaces` 的单工作空间自动进入逻辑保持不变。
- 不更改 API URL、数据库 schema、WorkspaceAction 枚举、计费或权限计算。

## 6. Risks and Mitigations

| 风险 | 缓解 |
| --- | --- |
| 工作空间页面双侧栏/双导航 | 根 `AppShell` 继续跳过 `/w/*`，只由 `WorkspaceShell` 渲染业务外壳 |
| 内部按钮跳回全局页面 | 全仓定向搜索硬编码业务路径，并增加路径构造测试 |
| 动态路由切换残留旧 Zustand 数据 | 工作空间绑定 reset + 请求代次检查 |
| capability 只隐藏导航但直接 URL 仍可进入 | 服务端布局先验证成员 capability；具体写操作继续由 API action 校验，页面不提升权限 |
| 旧 URL 永久缓存妨碍回滚 | 使用 307，不使用 308 |
| 脏工作树混入并行改动 | 只编辑任务文件和明确列出的 Web 路由/布局/测试文件，验证时使用定向命令 |

## 7. Rollback

回滚顺序：撤销 `next.config.mjs` 旧入口重定向、恢复旧 Sidebar 静态链接、恢复工作空间顶部导航并移除新增 wrapper。没有数据库或 API 合同变更，因此回滚不需要数据迁移。
