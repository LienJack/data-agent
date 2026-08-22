# Implementation Plan

1. `08-22-apple-blue-foundation`：设计 token、基础组件、Shell、设计规范与 contract tests。
2. `08-22-apple-blue-entry-workspace`：登录、Workspace 选择和首页。
3. `08-22-apple-blue-qa-analysis`：Q&A、Composer、Activity、Artifact 与 Resolution Inspector。
4. `08-22-apple-blue-semantic-knowledge`：Semantic Studio/Explorer/Review/Physical Schema 与 Knowledge。
5. `08-22-apple-blue-operations-admin`：Data Sources、Tests、Jobs、Members、Settings、Admin 和 dark/system theme 收口。

每一步执行：读取子任务 artifact/spec -> 实现 -> focused test -> Web unit/typecheck/build（按风险）-> 视觉/响应式检查 -> scoped commit -> archive 子任务。最后运行全站回归并归档父任务。
