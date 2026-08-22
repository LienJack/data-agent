# Technical Design

`design-system.css` 成为视觉 token 单一权威；`globals.css` 通过变量引用保留兼容名称。新增语义 utility：`surface-floating`、`surface-reading`、`control-pressable`、`focus-ring`、`page-command-bar`。基础组件只引用变量，不内嵌主题色。

Sidebar 只渲染产品导航和 authority 状态；ConversationDirectory 保留在 Q&A 页面上下文。Topbar 和 Mobile Nav 共享蓝调玻璃 token。所有 transition 只列出可动画属性。

兼容路径：保留 `.glass-*`、`.reading-surface`、`.page-*` 旧 class；新语义 class 与其共用实现，避免一次性破坏业务页面。
