# U4 删除计费产品面与运行时

## Goal

完整删除计费产品面、运行时代码和公共导出，不保留 API tombstone、redirect 或空实现。

## Requirements

- 覆盖 R10、R16；删除 price/fx/credit/hold/bill/settlement/reconciliation contracts、repositories、gates、jobs、UI/API。
- 保留 U2 Model Control、Provider direct gateway、技术预算和非商业 Usage 事实。
- 旧 Billing URL/handler 必须不存在并返回框架默认 404。

## Acceptance Criteria

- [x] Settings、Workspace Home、Admin navigation 不出现计费、价格、积分或账单入口。
- [x] Billing API/build handler、Worker pricing scheduler、package root export 为 0。
- [x] Model Provider、Q&A 模型选择与 Provider 调用测试通过。
- [x] 除历史 migration/archive/negative fixture 外生产 TS/TSX 无商业计费 surface。

## Notes

- 依赖：U3。
- `tests/billing-code-retirement.spec.ts` 固化默认 404（路由文件不存在）、零公共导出与零商业组合根。
- `pnpm typecheck`、Web production build、Model Provider/Q&A/Provider focused suites 均通过；构建仅保留既有动态文件追踪 warning。
