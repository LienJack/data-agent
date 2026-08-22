# Implementation Plan

1. 读取 frontend specs 与现有 CSS contract tests。
2. 合并 palette/material/type/radius/motion token，增加 contrast/reduced fallback。
3. 升级 UI primitives，保持 props 兼容。
4. 重构 WorkspaceShell、Sidebar、Topbar、Mobile Nav、Status Bar。
5. 更新设计规范与 focused tests。
6. 运行 Web unit、typecheck、build 与 diff checks；scoped commit 后归档。
