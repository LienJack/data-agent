# 平台设置模型供应商管理设计

## 1. Boundary

本任务把“供应商连接”和“供应商下的模型”拆成两个对象：

- `ModelProviderConnection`：共享供应商类型、显示名称、Base URL、凭据引用、来源、连接状态和配置版本。
- `ModelCatalogEntry`：属于某个供应商连接的具体模型，继续使用 PostgreSQL 权威状态 `ACTIVE | DISABLED | UNBILLABLE | DRAFT`、能力和配置版本。

这解决现有模型目录“每个模型重复保存 endpoint/credential、无法表达一个供应商包含多个模型”的问题。供应商 Card 只组合安全投影，不成为新的前端权威。

## 2. Authority and Permissions

- PostgreSQL 是手工供应商连接、模型目录、启停状态和审计的唯一权威。
- 只有当前仍为 `ACTIVE SUPER_ADMIN` 的主体可以创建、编辑、归档供应商，以及发现/选择模型；数据库事务内继续复核权限。
- 环境变量连接由服务端按当前进程配置合成，不写入数据库。稳定 ID 来自 provider binding，`source=environment`，所有 mutation API 在路由和数据库命令前失败关闭。
- 当前 `.env` 只投影 DeepSeek 与 Kimi；代码支持标准 `ZAI_API_KEY`，将来存在时 GLM 自动成为只读环境连接。本任务不写、删、重命名或输出任何 `.env` 值。
- 普通用户通过 `/api/models` 只读取可运行模型安全投影；管理员控制面使用 `/api/admin/model-providers/**`。

## 3. Provider Priority and Catalog

展示顺序固定为：

1. DeepSeek
2. Kimi
3. 智谱 GLM
4. OpenAI
5. Claude API
6. Grok、Gemini
7. 火山方舟、硅基流动、自定义 OpenAI-compatible

`MODEL_PROVIDER_CATALOG` 只描述品牌、协议、默认 URL 与展示能力。一个目录项可以对应零到多个真实连接；自定义 OpenAI-compatible 允许多个命名连接。所有实现都是 API Provider，不接入 Claude Code CLI/OAuth。

## 4. Data Model and Migration

新增 10649 migration source/rendered migration：

### `model_provider_connections`

- scope：`app_id + environment`
- identity：`provider_connection_id`
- fields：`vendor_id`、`runtime_provider`、`display_name`、`base_url`、`credential_ref`、`status`、`config_version`、`created_by/at`、`updated_at`
- status：`ACTIVE | ARCHIVED`
- 唯一约束：命名连接在同一 scope 内唯一；内置 vendor 可有多个账号连接，自定义兼容平台同样按 connection ID 区分。
- `credential_ref` 只保存 opaque metadata，快照中移除原对象并保存规范 locator/version/status。

### `model_catalog_entries`

- 增加 `provider_connection_id` 外键。
- 对既有手工模型按 `provider + base_url + credential_ref` 建立兼容连接并回填；不改写历史 `model_config_versions`。
- 新模型必须绑定连接；环境系统模型仍不写入该表。

### Commands

- `model-provider-upsert@1.0.0`：创建或按 `expected_config_version` 修改手工连接。
- `model-provider-archive@1.0.0`：事务内归档连接、把其全部非系统模型置为 `DISABLED`、清除 default，并写 operation/audit。
- 归档就是用户看到的“删除”：Card 从默认列表移除、运行不可再选择，但历史版本、账单与运行引用仍可审计。
- `model-provider-selection@1.0.0`：提交一次模型目录选择；对所选模型创建/更新目录项，对取消选择的模型置为 `DISABLED`。每个既有模型携带 expected version，冲突时整批失败。

## 5. Credential and Discovery Boundary

- 浏览器只提交 `provider_connection_id`，不把已经保存的 API Key重新发回客户端。
- 环境连接在服务端从 provider binding 的 allowlisted credential env 解析，API 响应只返回“环境托管”。
- 手工连接绑定现有 `global-model-credential-ref@1.0.0`；发现模型前服务端通过注入式 `ModelCredentialResolver` 解析短时凭据，使用后立即丢弃。
- 当前仓库没有可伪造成功的外部 Secret Authority resolver。实现必须提供明确端口和失败码；没有有效 resolver/receipt 时返回 `MODEL_CREDENTIAL_RESOLVER_UNAVAILABLE`，不得退回明文 Map、浏览器持久化或修改 `.env`。
- 发现请求只允许供应商目录中登记的 HTTPS endpoint；自定义 endpoint 继续做 DNS/IP/redirect/响应大小/超时限制。错误响应不得包含原始供应商 body、URL userinfo 或 secret。

这意味着本地现有 DeepSeek/Kimi 可以直接完成模型发现；手工供应商需要部署已有 SecretRef resolver 后才能真实发现。UI 对“尚未配置凭据”和“Secret Authority 不可用”给出不同状态。

## 6. Discovery and Activation Flow

```text
Provider Card
  -> 获取模型
  -> server resolves connection + credential
  -> provider-specific GET models adapter
  -> normalized model directory
  -> admin toggles multiple models
  -> selection command (transactional)
  -> ACTIVE only when credential + connection + price gates pass
  -> authoritative reload
```

- 目录发现是观察，不自动启动任何模型。
- UI 的“启动”表达管理员意图；若价格链或凭据门禁未满足，数据库拒绝 `ACTIVE`，模型保留为 `UNBILLABLE/DISABLED` 并显示原因。
- 修改 Base URL 或 CredentialRef 后，连接状态回到 `untested`，先前目录标为 stale；借鉴 DataFoundry 固定提交 `f96477a8` 的连接状态失效语义。
- 目录适配器覆盖 OpenAI-compatible、Anthropic 与 Gemini 的响应差异；DeepSeek、Kimi、GLM 和第三方聚合平台走相应 API/兼容协议。

## 7. Web Composition

`SettingsPage` 继续作为 Server Component，负责 session、role、workspace 和 feature flag。新增 client leaf `PlatformSettingsTabs` 管理三个一级 Tab：

- 模型配置：`ModelProvidersPanel`
- 组织与运维：现有 `OperationsAdminPanel`，以及 feature flag 允许的计费控制
- 语义管理：现有 `SemanticPortabilityPanel`

`ModelProvidersPanel` 维护服务端 DTO 的加载与 mutation 状态：

- 顶部：Tab 标题、只读权限说明、“新增供应商”动作。
- 主区：非等分响应式供应商 Card；DeepSeek/Kimi/GLM 优先，已配置在前。
- Card：品牌、来源、连接状态、启用数/总数、Base URL 安全展示、获取模型、配置、归档动作。
- 配置面板：供应商字段在上，模型目录在下；模型行使用 switch/checkbox 选择启动，不生成一组独立大 Card。
- 完整覆盖 skeleton、无配置、目录为空、stale、错误、版本冲突、保存中和成功状态。

普通用户看到安全只读 Card；写动作不渲染。环境 Card 显示“系统托管”，编辑/删除控件完全不出现。

## 8. Compatibility and Rollback

- `/w/:workspaceId/platform-settings` 与 `/settings` 继续复用同一页面，不改工作空间路由。
- `/api/models` 继续只返回 active 运行投影；旧 mutation 继续 410。
- 计费 UI 仍由 `BILLING_UI_ENABLED` 控制；本任务不重新开放默认隐藏的积分/价格区域。
- 迁移向前兼容既有 catalog entries；回滚 UI 时数据库新增表/列保留，不删除历史。
- 现有未提交 `model-provider-catalog`、`model-discovery`、`model-config-*` 文件作为本任务输入收口；提交前逐文件确认归属，只 stage 本任务明确使用的路径。

## 9. Key Trade-offs

- 使用供应商连接实体增加一次 migration 和 contract，但换来多模型共享凭据、供应商级编辑/归档与原子选择，避免在 UI 中假装分组。
- “删除”采用归档而非物理 DELETE，保留账单、配置版本和运行引用完整性。
- 不为赶 UI 恢复明文 API Key Map；手工连接在 Secret Authority 未部署时诚实失败关闭。
