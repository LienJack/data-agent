# 平台设置模型供应商管理实施计划

## 1. Baseline and Ownership

- [ ] 记录 `git status`，确认本任务只拥有任务目录、平台设置组合、模型供应商 UI/API/contracts/platform/migration 相关文件。
- [ ] 将现有未提交 `model-provider-catalog.ts`、`model-discovery.ts`、`model-config-*` 作为输入审查；保留可复用逻辑，删除与 PostgreSQL/SecretRef 权威冲突的 Map mutation 路径。
- [ ] 不修改、删除、格式化或 stage `.env`、`apps/web/tsconfig.tsbuildinfo` 和无关并行文件。

## 2. Contracts and PostgreSQL Authority

- [ ] 在 `@data-agent/contracts` 增加 provider connection、public/admin projection、upsert/archive/model-selection command 的严格 Zod 契约与测试。
- [ ] 创建 10649 migration source、renderer 和 rendered migration：provider connection 表、model catalog 连接外键、兼容回填、版本/权限/审计函数与精确 grants。
- [ ] selection/archive 命令在单一事务内锁定连接和子模型；expected version 不匹配时整批失败，归档同步停用全部模型。
- [ ] 扩展 Platform PostgreSQL repository 读写连接、发现所需的安全元数据和批量模型选择；补 repository/integration 测试。

## 3. Environment Projection and Discovery

- [ ] 把环境系统连接扩展为 DeepSeek、Kimi、GLM 的同序定义；只有对应 allowlisted key 实际存在时才投影，DeepSeek 保持首选默认。
- [ ] 保留环境 profile 稳定 ID 和 `SYSTEM_MODEL_IMMUTABLE` 双层 mutation guard；新增 GLM 与任意环境连接不可编辑/归档测试。
- [ ] 将 `model-discovery.ts` 收口为 provider-specific adapter + SSRF/超时/大小/重定向保护，返回统一多模型目录 DTO。
- [ ] 新增 server-only `ModelCredentialResolver` 端口：environment adapter 可用；SecretRef adapter 缺失/回执无效时显式失败关闭。
- [ ] 新增管理员 discovery route，只接受 connection ID；验证超级管理员、连接状态和凭据边界，不接受/记录明文 API Key。

## 4. Admin APIs

- [ ] 新增供应商连接 list/create/update/archive routes，统一使用超级管理员 guard、strict contracts、幂等键和稳定错误码。
- [ ] 新增模型 selection route；保存后返回权威连接 Card 投影并强制前端 reload。
- [ ] 保持 `/api/models` 只读 active 投影和旧 mutation 410；更新 API/secret boundary/role/version-conflict tests。

## 5. Platform Settings UI

- [ ] 新增 `PlatformSettingsTabs` client leaf，把模型配置、组织与运维、语义管理三个一级 Tab 组合到现有 Server Page。
- [ ] 新增/收口 `ModelProvidersPanel`、provider Card、配置面板和模型多选列表；排序 DeepSeek → Kimi → GLM → 其他。
- [ ] 环境 Card 显示系统托管且不渲染编辑/删除；手工 Card 支持编辑与确认归档。
- [ ] “获取模型”后显示多个模型，逐个选择启动；保存失败、门禁阻断、目录 stale 与版本冲突均内联展示。
- [ ] 非超级管理员使用只读投影；普通用户不挂载 mutation handlers。
- [ ] 继续使用现有 tokens、Card/Button/Badge/Tabs 与 Phosphor 图标；桌面非等分网格、移动端单列、可访问 tab/focus/label/description。
- [ ] 计费 UI feature flag 和语义/运维现有行为保持不变。

## 6. Validation

- [ ] `pnpm tsx scripts/render-10649-migration.ts --verify`
- [ ] contracts/platform/Web 相关 Vitest：provider connection contract、repository、system model immutability、discovery、admin routes、settings tabs/UI。
- [ ] `pnpm --filter @data-agent/web typecheck`
- [ ] 对本任务路径运行 `pnpm exec biome check <owned paths>`；不把全仓既有 lint 噪声归因到本任务。
- [ ] 需要时运行 clean PostgreSQL migration smoke，验证 10649 ledger/checksum、权限、回填、归档和批量选择。
- [ ] 使用已登录浏览器验证目标 URL：桌面和窄屏、三个 Tabs、DeepSeek/Kimi 环境 Card、多模型获取/选择、手工编辑/归档、普通用户只读、错误状态和控制台无 secret。

## 7. Review, Commit, Rollback

- [ ] 运行 `trellis-check` 范围审查；核对 PostgreSQL authority、secret boundary、非超级管理员失败关闭和并行 dirty tree 归属。
- [ ] 评估是否需要把新发现的稳定规范写回 Trellis spec；只更新确有新增规则的条目。
- [ ] `git diff --check`，显式 stage owned paths，复核 staged diff 不含 `.env`、tsbuildinfo 或无关改动。
- [ ] 创建一个 scoped commit；不 amend、不 squash、不改写既有 commits。
- [ ] 若 Secret Authority resolver 未部署，交付说明必须明确：环境供应商发现可用，手工 SecretRef 供应商保持 fail-closed，不能宣称已完成真实连接。

## 8. Implementation Record（2026-08-16）

- 已实现三个一级 Tab，模型配置默认展示供应商 Card；组织运维与语义管理复用既有面板。
- 已实现 DeepSeek、Kimi、GLM 优先的 API Provider 目录，兼容 OpenAI、Claude API、Grok、Gemini、火山引擎、硅基流动和自定义 OpenAI-compatible。
- 已新增 PostgreSQL 供应商连接、版本、归档和多模型选择权威；10649/10650 已迁移并通过回滚 smoke，归档同步停用子模型。
- 已实现环境供应商服务端投影。DeepSeek/Kimi 及未来由 `ZAI_API_KEY` 投影的 GLM 均不可编辑、删除或修改模型状态；本任务未修改、删除或 stage 任意 `.env` 文件。
- 已实现服务端模型目录发现和多模型启动意图保存。手工连接不接受浏览器明文 API Key；当前通过确定性服务端注入 locator 解析，缺少 Secret Authority 注入时返回 `MODEL_CREDENTIAL_RESOLVER_UNAVAILABLE`，选中模型保持 `UNBILLABLE`，不伪装为已运行。
- `trellis-check` 范围审查完成：PostgreSQL authority、SUPER_ADMIN mutation、strict Zod、审计归档、Secret redaction 与并行 dirty tree 均按任务边界处理；现有规范已覆盖这些规则，无需追加 Trellis spec。
- 验证通过：10649/10650 renderer checksum、contracts 3 tests + typecheck、platform 5 tests + typecheck、Web 20 focused tests、Web 全量 unit（60 files，219 tests，1 skipped）、范围 Biome、数据库 selection/archive rollback smoke、登录浏览器桌面与 390px 三 Tab/供应商目录验收、真实 DeepSeek 多模型获取。
- 全量 Web typecheck 当前仅被本任务外并行文件 `apps/web/src/cli/qa-resource-switch-smoke.ts:23` 的 `Dict<string>` 类型错误阻塞；本任务没有修改该文件，相关测试和此前无该并行文件时的 Web typecheck 已通过。
