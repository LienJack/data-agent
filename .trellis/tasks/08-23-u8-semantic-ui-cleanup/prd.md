# U8 拆分语义 UI 并删除遗留入口

## Goal

拆分 Semantic Studio/Editor/Explorer 状态与渲染职责，并删除所有旧 Semantic/Data Link 页面、store、mock auth 和 redirect。

## Requirements

- 覆盖 R8、R9、R16；唯一用户入口是 Workspace Semantic Studio/Explorer。
- Transport/SSE、server snapshot、selection、draft、save/publish 由 controller/reducer 管理，panel 只渲染 props。
- Direct Editor 与 Studio 共享 typed editor state/command adapter，不创建 client authority。
- 删除 `/semantic`、`/data-link`、Workspace Data Link routes 及 Next redirects、legacy store/reset/mock auth。

## Acceptance Criteria

- [ ] SSE reconnect/duplicate/stale/save conflict/publish 状态由 reducer/controller 确定处理。
- [ ] Workspace 切换隔离 draft/selection/SSE/error；无旧 store alias/no-op reset。
- [ ] Studio/Explorer loading/empty/error/read-only/edit/publish 与键盘/ARIA 测试通过。
- [ ] 旧 URL 默认 404，route/build manifest、bundle 和 test graph 无 legacy entry/redirect。
- [ ] Trellis 规范更新为 V2-only、Model Control 当前边界和 Billing Retirement 历史说明。

## Notes

- 依赖：U7。
