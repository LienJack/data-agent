# U2 设计

- Contracts：`models/` 定义 model profile/catalog/readiness，`providers/` 定义 connection/credential reference。
- Platform：`postgres-model-control` 对应单一 Port，不承载价格/账务逻辑。
- Web：`model-control-admin` 只做 capability、strict parse、repository 调用和 DTO mapping。
- `workspace-identity` 不聚合 Pricing/Credit/Billing repository。
- 工作区中可先新增后切换，但提交态旧符号和兼容导出必须为 0。
