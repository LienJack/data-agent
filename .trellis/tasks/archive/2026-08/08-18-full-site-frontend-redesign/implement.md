# Implementation

- [x] 建立全局 design tokens、typography、focus、scrollbar 与 responsive primitives。
- [x] 重构 App/Workspace shell、sidebar、topbar、statusbar 和 mobile navigation。
- [x] 重构 workspace picker/home 与通用 page header / section / table surfaces。
- [x] 对齐 Agent QA、reasoning、tool、stage、Team Trace 的折叠展示。
- [x] 调整数据源、语义、测试、设置与身份页面的信息密度和状态。
- [x] 运行 Web tests/typecheck/build：325 passed、1 skipped；typecheck/build PASS。
- [x] 1440/390 浏览器截图、overflow、keyboard、disclosure 验收。
- [ ] scoped commit 与归档。

## Evidence

- `artifacts/frontend-redesign/`：14 张桌面/移动截图。
- Workspace、Analysis、QA、Tests、Members、Semantic、Login 在 390px 均无 document overflow。
- Agent tool disclosure：默认折叠，Enter 切换 `aria-expanded=false -> true`。
- Production build：49 个页面生成成功；仅保留既有 Turbopack dynamic filesystem warnings。
