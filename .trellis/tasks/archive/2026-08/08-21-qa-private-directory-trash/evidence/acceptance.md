# 私有会话目录与 30 天回收站验收

验收日期：2026-08-22（Asia/Shanghai）

## 结论

本 child task 的 AC1–AC10 为 PASS。PostgreSQL 是目录、生命周期、owner isolation、30 天到期时间与 retention receipt 的权威；Web mutation 均等待服务端提交并重新拉取目录，不做乐观 authority mutation。

## 自动化证据

- Contracts typecheck PASS；`workspace-conversation-directory.spec.ts` 4/4 PASS。
- Platform typecheck/build PASS；`workspace-data-repository.spec.ts` 13/13 PASS。
- Worker typecheck/build PASS；retention focused tests 2/2 PASS。
- Web typecheck PASS；directory focused tests 29/29 PASS；Web 全量 unit 104 files PASS、1 skipped，378 tests PASS、1 skipped。
- Web production build PASS；仅保留项目已有的 Turbopack dynamic filesystem tracing warnings。
- scoped Biome PASS；`git diff --check` PASS。
- 10673 renderer verify PASS，checksum：`sha256:a1f5306327147f2d1571c66d5eb7c286ce7da2c74a3183ca8a02ac179813d22a`。
- SQL static check PASS。
- fresh PostgreSQL 17 full migration chain + `49-qa-directory-assertions.sql` PASS，marker：`U24_QA_DIRECTORY_ASSERTIONS_PASSED`。

PostgreSQL smoke 覆盖：同 Workspace 两 owner 互不可见、跨 owner Folder move 拒绝、folder create/replay、conversation move/rename/archive/restore/trash、folder delete atomic ungroup、active Run trash gate、到期前不可 claim、到期空会话 PURGED、存在引用时 HELD、RLS/GRANT surface。

## 真实 Web + Worker + DB

工作空间：`908daa22-1bb5-4029-a616-22d0dece1c0b`。

在真实登录会话中完成：

1. 创建 Folder，刷新后仍存在。
2. 创建独立验收 Conversation；重命名并移动到 Folder。
3. Conversation 归档、恢复、移入回收站、从回收站恢复。
4. Folder 重命名、归档、恢复、删除；删除后 Conversation 原子回到未分类。
5. 搜索由服务端 `q` 参数返回授权标题/Message 命中。
6. 最终把验收 Conversation 放入回收站，UI 显示服务端权威的“30 天后清理”。
7. 使用第二个全新浏览器会话重新登录，回收站仍显示同一 Conversation 和 30 天倒计时。
8. 弹窗自动聚焦；Shift+Tab 从首控件闭环到提交按钮；关闭后焦点返回菜单触发器。
9. 目录视图快速切换时，stale active response 不再覆盖 archived/trash snapshot。
10. trash Conversation 的 direct Run GET/SSE binding 与 Artifact Preview 均返回 not-found-or-denied；focused route/repository regression PASS。

运行健康：

- Web `/api/ready`：`live=true, ready=true`。
- Worker `/live`：`status=ready`，Run queue 与 Job queue 均 ready，最近 cycle 为 IDLE。
- Indexer `/live`：`status=ready`。
- Semantic authoring worker 因本地 certified model 未就绪而等待；不影响本 task 的目录/retention 验收。

## 视觉与几何

- [桌面 1440×1000](./desktop-directory.png)
- [移动端 390×844](./mobile-directory.png)

移动端实测：viewport/document 均为 390px，无横向溢出；Drawer 为 339×844，内容高度稳定。修复了 header `backdrop-filter` 形成 fixed containing block 后 Drawer 只有 51px 高，以及 Drawer stacking 被主内容覆盖的问题。

## 浏览器验收期间修复的回归

- 生命周期视图缺少原 Folder projection 时，Conversation 回退到“未分类”，不再漏显。
- Directory GET 使用 generation guard，快速切换 active/archived/trash 时拒绝晚到响应。
- Row menu 根据可用空间向上/向下展开，避免被 Sidebar footer 裁切或遮挡。
- Modal 增加初始焦点、Tab trap、Escape、focus return。
- 移动 Drawer 使用明确 `100dvh` 且提升 Topbar stacking context。

## 非本任务 HOLD

- Platform 全量 unit 在并行的 `knowledge-driven-semantic-layer` 未完成变更上出现一项 foundational source registration 失败；本 task 的 Platform focused 12/12、typecheck 与 build 均 PASS。该并行变更未纳入本 task commit，也不改变本 task 结论。
- Apple Glass 全局视觉 token、管理员跨 owner 审计和旧归因下线分别由后续 child tasks 交付。
