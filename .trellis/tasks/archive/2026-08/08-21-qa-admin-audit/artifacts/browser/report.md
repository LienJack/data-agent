# Q&A 管理员审计平面浏览器验收

## Summary

- Surface：`/w/908daa22-1bb5-4029-a616-22d0dece1c0b/qa/admin`、`/admin/qa`
- Viewports：1440x1000、390x844
- Open issues：0
- Evidence 使用本地合成 Workspace、UUID 与业务问题；未包含凭据、SecretRef、provider payload 或私有推理。

## Coverage

- Workspace Admin 显式入口、只读 banner、owner/lifecycle/live/folder/search filters。
- Super Admin 全局入口与 Workspace selector。
- 跨 owner directory、messages、public trajectory、Subagent/Tool 行与 receipt identity。
- Artifact 点击后只显示安全 projection，并生成 `ARTIFACT_PREVIEW` receipt。
- 桌面三栏布局；移动端“目录 → 详情 → Inspector”逐层导航与返回动作。
- 管理页面不包含 Composer、重命名、移动、归档、删除、恢复或 Run control。

## Resolved During Acceptance

| Severity | Finding | Resolution |
|---|---|---|
| P1 | 10675 将 SQL 表达式 `COALESCE` 错误限定为 `pg_catalog.coalesce`，真实目录读取返回 503。 | 新增 immutable forward migration 10676，按 exact function definition 修复并校验 ledger checksum。 |
| P1 | 390px 单列 grid 中目录占满可滚动区域，已加载详情不可达。 | 移动端改成目录、详情、Inspector 逐层导航；桌面保持三栏。 |
| P1 | 管理轨迹只有 JSON snapshot，RUNNING 对话没有独立审计 SSE。 | 新增 `text/event-stream` short-page replay；每次 reconnect 重验并写 receipt，客户端 Abort + generation guard。 |
| P2 | Directory API 接受数据库数值 offset cursor，无法绑定 actor/scope/filter。 | Web transport 改为基于 `BETTER_AUTH_SECRET` 的 15 分钟 HMAC opaque cursor；篡改、换 actor/filter 与过期均失败。 |

## Screenshots

- [Desktop 1440x1000](./screenshots/workspace-admin-desktop.png)
- [Mobile 390x844](./screenshots/workspace-admin-mobile.png)

## Verification Notes

- 浏览器真实读取后，live PostgreSQL 存在 `DIRECTORY_READ`、`MESSAGES_READ`、`TRAJECTORY_READ`、`ARTIFACT_PREVIEW` receipt。
- Fresh PostgreSQL 17 assertion 另覆盖 `RUN_REPLAY`、`SUBAGENT_READ` 与 `ARTIFACT_EXPORT`。
- 当前浏览器数据没有 RUNNING conversation；SSE transport/reconnect 由 route unit、client merge unit 和 fresh DB RUNNING fixture 组合证明。
