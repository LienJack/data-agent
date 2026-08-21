# 实施计划

## Phase 0 规格与基线

- [x] 将父任务 R36–R43、R48–R51 / AC20–AC22、AC26–AC28 收敛到 child PRD/design。
- [x] 读取 backend/frontend specs 与 cross-layer/code-reuse guides。
- [x] 启动 task，冻结 dirty tree 与 owned paths。

## Phase 1 Contracts

- [x] 新增 v2 Conversation、Folder、Directory page/search、Command/Result、Retention strict schemas。
- [x] 保留 v1 decoder；补 unknown field、状态矩阵、hash/tamper、owner identity tests。
- [x] 从 package index 单点导出，build/typecheck。

## Phase 2 PostgreSQL 10673

- [x] 建立分段 source、renderer、checksum 与静态闭包。
- [x] 新表/列、composite owner FK、状态/30 天 CHECK、索引、FORCE RLS/grants。
- [x] Owner command RPC + operation receipt；Folder delete atomic ungroup；active Run delete gate。
- [x] Retention claim/complete/HELD receipt，DB time + lease/fence。
- [x] fresh full migration chain + PostgreSQL 17 两 owner/isolation/lifecycle/retention smoke。

## Phase 3 Platform / API

- [x] 扩展 repository 的 directory list/search/commands/retention；所有 unknown 在边界解析。
- [x] 保留 active list read compatibility；旧 DELETE 改 soft trash。
- [x] 新增 owner Folder/directory command routes；GET query cursor/view/filter。
- [x] trash conversation 的 GET/messages/trajectory/SSE/Preview 统一 deny。
- [x] focused repository/route tests。

## Phase 4 Web

- [x] QA store 使用 server directory snapshot、view/filter/cursor/pending command；不做 optimistic authority mutation。
- [x] Sidebar directory：Folder/未分组、最近 5 条、expand/search/new/menu、相对时间/live state。
- [x] rename/move/reorder/archive/trash/restore 与二次确认；错误码和 selection preservation。
- [x] mobile drawer 复用 projection；tree/treeitem、Enter/Space、focus return、排序替代。
- [x] store/component/i18n/accessibility tests。

## Phase 5 纵向验收

- [x] Contracts/Platform/Web typecheck、focused/full relevant unit、Biome、diff check。
- [x] render 10673 verify、fresh PostgreSQL chain + smoke、production Web build。
- [x] 真实 Web + DB：Folder create/move/rename/archive/restore/delete、Conversation rename/archive/trash/restore、refresh。
- [x] 1440x1000、390x844 screenshot + no-overflow/focus geometry evidence。
- [x] 写 `evidence/acceptance.md`，清晰区分 PASS 与 HOLD。

## Phase 6 收尾

- [ ] scoped commit（只 stage owned paths）。
- [ ] `trellis-check` 后 archive child。
- [ ] 记录 journal，再进入 `qa-admin-audit`。
