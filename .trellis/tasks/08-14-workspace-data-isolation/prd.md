# 工作空间持久化与数据隔离

## Goal

移除 Web 请求路径上的进程内业务权威、固定 tenant/principal 和 `workspaceId="default"`，
让数据源、Schema Discovery、Q&A、语义治理以及新建分析运行统一由登录会话和当前工作空间
的 PostgreSQL authority 隔离。

## Requirements

- `workspace_id` 与现有 `tenant_id` 是同一 UUID；不得新增 project 层或第二套隔离键。
- 数据源连接持久化到 PostgreSQL，完整主键包含 `app_id + tenant_id + environment`；凭证只
  保存经过 strict contract 校验的 `SecretRef` 元数据，不保存密码、DSN 或 provider locator。
- 一个工作空间可以拥有多个数据源；对象 ID 查询必须同时带完整 scope，跨空间访问统一
  返回不泄露对象存在性的拒绝结果。
- Q&A conversation 与 message 持久化到 PostgreSQL。conversation 归属于创建者和当前
  workspace；首次写消息前必须绑定当前 workspace 的一个 active datasource，写入消息后
  datasource 不可变。
- 语义 Explorer、Candidate、Governance 和 Schema Discovery 的产品请求不得从
  `SEMANTIC_TENANT_ID`、`SEMANTIC_PRINCIPAL_ID`、`SCHEMA_DISCOVERY_TENANT_ID` 等固定环境
  变量获取身份；必须从 Cookie session 与统一 workspace guard 获取 capability。
- 产品 API 使用 `/api/workspaces/:workspaceId/...`，或由同等严格的统一 workspace guard
  包装；旧无 session、无 workspace authority 的 mutation 路径必须失败关闭。
- 现有 Run、Artifact、Attribution、Test、Semantic PostgreSQL authority 继续复用，新增
  datasource 绑定使用复合外键，不建设第二套 Run/Artifact 状态机。
- 新建产品分析运行必须携带当前 workspace 的 datasource identity；客户端自报 role、
  principal 或 header 不构成授权。
- 本项目没有需保留的数据，只验证 clean install；开发数据库允许删除重建，不写 backfill、
  双写、旧 Map 迁移或在线升级兼容分支。

## Acceptance Criteria

- [ ] AC-P2-1. 两个 workspace 各自创建 datasource/conversation/message 后，列表、详情和
  对象 ID 查询只返回当前 workspace 数据；无成员资格和跨 workspace UUID 均失败关闭。
- [ ] AC-P2-2. 两个独立 PostgreSQL Pool/Repository 实例可以读到彼此已提交的数据，进程
  重启不丢失；Web 产品路径不再 import datasource/Q&A `Map` authority。
- [ ] AC-P2-3. datasource SecretRef scope 或版本不匹配时拒绝创建；公开 DTO、日志与数据库
  connection 表均无明文 secret/DSN/provider locator。
- [ ] AC-P2-4. conversation 首次消息前必须绑定 active datasource；绑定不能跨 workspace，
  首次消息后不能改绑；message/run 只能引用同一 conversation/workspace/datasource。
- [ ] AC-P2-5. Semantic Explorer/Candidate/Governance 与 Schema Discovery 的请求级
  authority 来自有效 Cookie session 和 route/header workspace，经同一事务重验；固定
  tenant/principal 环境变量不再位于产品请求路径。
- [ ] AC-P2-6. 未登录、停用用户、撤销成员、归档 workspace、VIEWER 写入和客户端伪造
  role/principal 都返回稳定公开错误，且不泄露目标对象是否存在。
- [ ] AC-P2-7. `rg` 证明产品路径中 `workspaceId="default"`、固定产品 principal 和旧
  datasource/Q&A Map 写路径归零；legacy unscoped mutation route 不再可用。
- [ ] AC-P2-8. 10628 renderer/static check、clean-install PostgreSQL smoke、repository
  conformance、Web lint/typecheck/unit 和双 workspace 集成测试全部通过。

## Out of Scope

- 模型目录持久化、价格/汇率、积分与计费结算（Phase 3-5）。
- 语义 JSON 导入导出（Phase 6）。
- 完整管理 UI、移动端与角色矩阵浏览器 E2E（Phase 7）。
- 旧开发数据保留、backfill、双写、shadow repository 或在线迁移。

## Parent Traceability

- Parent requirements：R1-R6、R8.3、R13.2、D1、D8、D15、D16。
- Parent acceptance：AC1、AC2、AC3、AC10、AC11、AC12、AC20 的 Phase 2 部分。
