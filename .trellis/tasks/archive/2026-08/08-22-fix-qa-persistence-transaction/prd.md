# 修复 Q&A 持久化事务失败

## Goal

恢复工作空间 `908daa22-1bb5-4029-a616-22d0dece1c0b` 的 Q&A 提问与运行轨迹读取，使新问题可以原子创建 Run，并让页面轮询不再触发数据库 schema 错误。

## Background

- 2026-08-22 15:05（Asia/Shanghai），用户在 `/w/908daa22-1bb5-4029-a616-22d0dece1c0b/qa` 提问后收到 `PERSISTENCE_TRANSACTION_FAILED`。
- PostgreSQL 同时记录：
  - `accept_question_run_with_effective_config(jsonb,jsonb)` 调用 `subagent_catalog_snapshot_is_valid(jsonb,text)` 时返回 SQLSTATE `42501`，原因是 `data_agent_effective_config_rpc_owner` 没有该函数的 `EXECUTE` 权限；
  - 轨迹读取 SQL 查询不存在的 `runs.active_attempt_id`；
  - Platform 调用尚未迁移到本地数据库的 `load_agent_team_public_projection_v2(uuid)`。
- 10696 已在本地 ledger 以 checksum `sha256:8e74...cdac2` 登记，随后仓库内同名 migration 被原地改成 `sha256:853f...1100b`；10697 尚未应用。当前 migration inventory 因而是一个 checksum mismatch 加一个 missing migration。
- 15:05 的事务完整回滚，数据库没有该次提问对应的新 Run、Binding、Config Receipt 或 Outbox；现有对话和历史 Run 的复合外键/计数未显示脏数据证据。

## Requirements

1. 必须修复 `PERSISTENCE_TRANSACTION_FAILED` 的真实权限因果链，不通过删除历史会话或 Run 掩盖问题。
2. 已应用的 10696 migration 必须恢复为 ledger 对应的不可变 bytes；13:48 后加入的行为通过新的 forward repair migration 交付，不改写既有 ledger 历史。
3. 新 repair migration 必须：
   - 以前置 ledger 和 PostgreSQL 17 为失败关闭条件；
   - 将 10696 后补的 Profile revocation 与 `visible_message_refs` 行为前向升级到已安装数据库；
   - 只向 `data_agent_effective_config_rpc_owner` 授予 `subagent_catalog_snapshot_is_valid(jsonb,text)` 所需的精确 `EXECUTE`；
   - 保持 `PUBLIC` 与普通 `data_agent_backend` 无该内部 validator 的直接执行权；
   - 以 postcondition 验证函数定义、owner/ACL 和旧 ledger checksum。
4. Resolution Trace 必须从权威 `run_attempts` 中解析当前 `ACTIVE` attempt，不得读取不存在的 `runs.active_attempt_id`，也不得按最新非 ACTIVE attempt 猜测当前执行。
5. 10697 与新的 repair migration 必须通过正常 `pnpm dev:migrate` 应用，Migration Ledger 恢复 current；不得手工修改 ledger 或直接在数据库中长期打补丁。
6. 保留所有现有对话、消息、Run、Receipt 与 Outbox。只有重新出现可精确证明的脏记录时，才可按完整 `app_id + tenant_id + environment + object_id` 范围删除；本任务当前不执行数据删除。
7. 所有仓库变更必须通过相关验证并形成一个仅包含本任务文件的 scoped Git commit。

## Acceptance Criteria

- [x] 10696 渲染验证重新得到 ledger 已登记的 `sha256:8e74...cdac2`，`pnpm dev:migrate` 不再报告 10696 checksum mismatch。
- [x] 新 forward migration 有固定 checksum、baseline、advisory lock、最小 ACL 和失败关闭 postcondition，并成功登记到 ledger。
- [x] `data_agent_effective_config_rpc_owner` 可以执行 validator；`PUBLIC` 与普通 `data_agent_backend` 不可直接执行。
- [x] 10697 已登记，`load_agent_team_public_projection_v2(uuid)` 存在且仅授权给预期 backend role。
- [x] Resolution Trace authority SQL 不再引用 `run.active_attempt_id`；仅返回 `status = 'ACTIVE'` 的权威 attempt，终态 Run 返回 `null`。
- [x] 新增/修改测试先复现：缺失 transitive grant、10696 checksum 漂移、错误的 Run 列引用；修复后全部通过。
- [x] Platform focused unit tests、migration static tests、renderer verify、相关 typecheck/format check 通过。
- [x] 本地 migration 后查询不再出现这三类 PostgreSQL 错误，且目标工作空间现有数据计数保持不变。
- [x] 创建一个 scoped Git commit，未纳入 `apps/web/next-env.d.ts`、`apps/web/tsconfig.tsbuildinfo`、Falcon artifacts 或其他并行任务文件。

## Out of Scope

- 删除或重建整个 PostgreSQL volume。
- 清空目标工作空间、对话或历史 Run。
- 更改 Q&A 产品交互、模型选择或 Worker 业务行为。
- 为公开响应暴露原始数据库错误详情。
- 顺带修复与本错误无关的 Falcon、Semantic Layer 或其他并行工作。

## Risks and Deferred Items

- migration 是前向且不可回写；实施前记录目标表计数和 ledger，实施后逐项核对。
- 当前 Web 进程由用户的外部终端启动；优先依赖热更新与数据库 migration，不主动终止该进程。
- 浏览器控制环境没有用户已登录的 Q&A 标签页。最终端到端可先以数据库权限 postcondition、API/Platform tests 和 PostgreSQL 错误日志为证；若用户保持已登录页面可用，再补一次真实 UI 提问验证。
