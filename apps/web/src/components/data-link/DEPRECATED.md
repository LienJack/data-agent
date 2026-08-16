# Data Link 语义视图已退役

此目录仅保留旧界面实现用于历史追溯，不再属于活动产品入口。

- 不得从新页面导入这里的组件或 `data-link-store.ts`。
- 不得停用 `/api/semantic/*`：这些 API 属于当前 Semantic Studio/Explorer，而不是旧 Data Link。
- 旧 `/data-link/*` 进入工作空间选择；旧 `/w/:workspaceId/data-link/*` 统一跳转到
  `/w/:workspaceId/semantic`。
- 新增或编辑 Node/Edge 只能通过 Agent authoring 和 Candidate/Review/Publish 治理链路。
