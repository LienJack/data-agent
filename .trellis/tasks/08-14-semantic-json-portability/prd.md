# 语义 JSON 导入导出

## Goal

让工作空间能够安全导出当前已发布语义，并把兼容文件导入为目标工作空间内待治理草稿；任何导入都不能自动发布、创建数据源或携带身份与凭据。

## Requirements

- 导出格式固定为 `semantic-workspace-export@1.0.0`，使用严格 schema 和规范内容哈希。
- 仅导出当前工作空间各活跃语义域的当前 published release 与逻辑数据源引用。
- 导出不得包含 workspace/app 标识、成员或审核人身份、SecretRef locator、连接参数或凭据。
- 上传上限为 1 MiB；未知版本、未知字段、哈希错误、可疑明文 secret 或恶意嵌套结构失败关闭。
- 导入任务持久化经历 `UPLOADED -> VALIDATED -> AWAITING_DATASOURCE_MAPPING -> READY -> DRAFT_CREATED`，并支持 `FAILED/CANCELLED`。
- 每个逻辑数据源都必须显式映射到目标工作空间内 ACTIVE 数据源及其活跃语义域；缺失、重复、歧义或跨工作空间映射不得进入 READY。
- dry-run 返回兼容性、缺失引用、映射冲突和将创建的草稿摘要，不产生语义草稿。
- `READY -> DRAFT_CREATED` 在一个 PostgreSQL 事务中为全部语义域创建候选草稿、导入 receipt 和不可变 audit；失败不得留下部分草稿。
- 同一上传内容与同一规范映射重复提交稳定返回同一结果；异载荷复用幂等键返回冲突。
- 界面提供导出、上传、预览、映射、暂停/继续、失败原因和草稿结果，并覆盖 loading/empty/error/success 状态。

## Acceptance Criteria

- [ ] AC1：当前 published release 可 round-trip 导出、严格验证并在目标工作空间创建 DRAFT 候选。
- [ ] AC2：导出 JSON 不包含 workspace/app ID、principal/reviewer、SecretRef locator、host、username、database、path 或 credential 字段。
- [ ] AC3：文件超限、未知版本、未知字段、哈希不匹配和疑似 secret 均不创建导入任务或草稿。
- [ ] AC4：缺少/重复/跨工作空间 datasource mapping 时任务保持暂停或失败，不能 READY。
- [ ] AC5：成功导入的所有候选均为 DRAFT，继续复用既有审核、发布和回滚流程。
- [ ] AC6：草稿、receipt 与 audit 原子提交；故障注入证明无部分状态。
- [ ] AC7：相同内容与规范映射幂等重放，同键异载荷失败关闭且不覆盖已发布历史。
- [ ] AC8：contracts、平台 repository、真实 PostgreSQL smoke、Route Handler 与前端类型/单测通过。
- [ ] AC9：一张关键截图证明导入导出界面与项目既有低饱和绿色、紧凑工作台设计语言一致。

## Constraints

- 项目尚无生产数据，只支持 clean install；不实现历史数据迁移或 backfill。
- 不自动创建数据源、SecretRef 或占位连接。
- 不引入第二套语义发布状态机。
