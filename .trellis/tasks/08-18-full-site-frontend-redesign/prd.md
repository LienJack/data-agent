# 全站前端信息架构与视觉重设计

## Goal

Falcon GO 后使用 design-taste-frontend 重设计全部前端页面、布局、信息密度、Agent SSE 工具/思考折叠与响应式体验。

## Requirements

- 所有平台页、身份页、工作空间页和兼容页共享同一色彩、字体、间距、边线与交互状态。
- 桌面提供稳定侧栏和顶栏；小于 1024px 切换为顶部品牌条 + 底部主导航，无横向溢出。
- 工作台优先使用全宽分区、列表、表格与 split-pane，避免 section/card 套 card。
- 数字等宽，状态有文字和颜色，标题紧凑，长 ID 可截断并保留可访问名称。
- QA、Semantic Agent、Team Trace 的 reasoning/tool/stage 默认折叠，只显示公共摘要、状态、耗时、
  输入/输出投影；禁止 private chain-of-thought、reasoning_content、SecretRef 与 Provider 原始载荷。
- Loading 使用布局匹配 skeleton，Empty/Error 有明确下一步，按钮具备 hover/active/focus-visible。

## Acceptance Criteria

- [ ] 共享 shell 覆盖全部 page/layout 入口；身份、工作空间、分析、QA、数据源、语义、测试、设置逐类验收。
- [ ] Web unit/typecheck/build 通过，Agent disclosure 与移动导航有 focused tests。
- [ ] 1440x1000 与 390x844 无 document horizontal overflow、文本/工具栏重叠。
- [ ] `design-taste-frontend` 桌面/移动截图与键盘 disclosure 验收通过。
- [ ] scoped commit 与 Trellis archive 完成。
