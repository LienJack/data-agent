# 分阶段实施计划

## 实施原则

这是跨身份、数据库、运行时和前端的高风险改造。采用一个父任务管理依赖，按下面八个
可独立验收的子阶段实施。每个阶段先提交契约和失败测试，再提交 migration/adapter/UI；
未通过当前阶段门禁不进入下一阶段。实施前由用户明确批准本计划。

所有阶段采用“后端权威 + 可操作前端 + 一次截图验收”的完成标准。管理与操作界面可参考
new-api 的计费管理信息密度、DeepSeek Harness 的运行状态反馈、WrenAI 的数据产品信息架构，
但必须复用本项目既有组件、设计令牌和中文产品语言；不得把 API 存在等同于功能完成。

## Phase 0：冻结契约与迁移基线

目标：先定义唯一术语、DTO、错误语义和当前行为基线，防止各层自行发明 workspace、
角色或计费类型。

- [x] 在 `.trellis/spec` 补充 app-global 私有控制面对象例外、workspace 权限矩阵和账务
  精度/状态机规范。
- [x] 在 `packages/contracts` 增加 workspace、identity、RBAC、price、FX、credit、bill、
  semantic import/export 的 strict Zod schema 和判别联合。
- [x] 为当前固定 tenant、内存 datasource/model/conversation 行为写 characterization tests。
- [x] 建立 reason code 矩阵和 migration inventory，记录每张现有表如何映射 workspace。
- [x] 确认 Better Auth 锁定版本、许可证、Next 16/Node 26/PostgreSQL 17 兼容性，并生成
  可审查 SQL，不执行运行时自动迁移。

验收门禁：contracts build/typecheck；未知字段失败关闭；迁移清单覆盖所有现有业务表；
没有产品代码仍读取第二套“project”标识。

## Phase 1：身份、工作空间与 RBAC Authority

目标：登录用户能够选择工作空间，所有受保护请求从数据库获得有效 capability。

- [x] 增加认证私有 schema、`app_users`、`workspaces`、成员扩展字段、lifecycle/authz epoch、
  operation receipt 和 audit migration。
- [x] 集成 email/password Cookie session，关闭公开 sign-up 与 impersonation；提供只可在
  受控部署环境运行的首个超级管理员 bootstrap CLI。
- [x] 实现 session principal resolver 和 workspace authority resolver，在同一事务重验
  用户状态、工作空间状态、成员版本和全局角色。
- [x] 实现超级管理员创建/停用/重置用户、创建/归档/恢复工作空间，以及工作空间管理员
  管理已有用户成员关系的幂等命令。
- [x] 增加登录页、工作空间选择器和按角色过滤的导航骨架。
- [x] 更新现有 capability conformance fixtures，覆盖旧 capability 在停用、撤权、归档、
  角色变化后失效。

验收门禁：Phase 1 新增的受保护 workspace 路由无 session 全部拒绝；客户端伪造
role/workspace 无效；直接对象 ID 越权不泄露；停用用户立即失败关闭；至少一个超级管理员
可恢复系统管理。Legacy 业务 API 的统一切换属于 Phase 2。

## Phase 2：工作空间持久化与数据隔离迁移

目标：移除 Web 进程内业务权威和固定 workspace，完成数据源、对话、语义与归因隔离。

- [x] 为 datasource connections/schema snapshots 建立 PostgreSQL repository 和复合 FK；
  凭证只引用 SecretRef。
- [x] 为 Q&A conversations/messages 建立 workspace-scoped repository；一个 conversation
  固定一个属于当前 workspace 的 datasource。
- [x] 修改 semantic explorer/candidate runtime，从 capability 获取 scope/principal，删除
  请求路径上的固定环境变量身份。
- [x] 审计 attribution、runs、tests、artifacts 和 projections 的每个读写入口，补齐 scope
  predicate 与 datasource workspace 校验。
- [x] 把 API 移到 `/api/workspaces/:workspaceId/...` 或由统一 guard 包装；移除旧无作用域
  mutation route。
- [x] clean install 创建 bootstrap workspace；开发库直接重建，不实现旧数据 backfill。

验收门禁：双工作空间隔离集成测试；所有 repository conformance；两个 Node 实例看到一致
数据；Map 不再是权威；旧固定 `workspaceId="default"` 和固定 principal 运行路径归零。

## Phase 3：模型控制面、官方价格与汇率版本

目标：只有超级管理员能够维护模型，并形成可审计、不可变的计费输入。

- [x] 建立 model catalog/config version、price candidate/version/component、FX candidate/version
  和同步 operation 表及约束。
- [x] 把当前 model Map 迁移为 PostgreSQL repository；SecretRef 继续走现有 secret provider。
- [x] 实现 OpenAI、Anthropic、Gemini、DeepSeek、xAI、Kimi、GLM 独立价格来源适配器；
  按实际启用 provider 分批交付，未实现的 provider 保持不可计费。
- [x] 实现 CFETS/PBOC 汇率适配器、内容哈希幂等、异常 diff 和最近有效版本策略。
- [x] 建立 worker 定时同步、raw evidence 限额存储、解析 fixture、候选审批和版本激活 UI。
- [x] 扩展现有 pricing contract，支持缓存、阶梯、工具等明确维度；不能表达的价格形态失败
  关闭。

验收门禁：非超级管理员 API/UI 均不能变更；抓取失败不覆盖 active；时间区间不重叠；
同一证据不重复建候选；激活操作原子且历史版本不可变。

## Phase 4：全局用户积分账户与账本

目标：提供无支付的管理员积分分配和可证明一致的用户余额。

- [x] 建立 `credit_accounts`、append-only ledger、holds、billing operations 和审计 migration；
  trigger 禁止更新/删除账本。
- [x] 实现 bigint/microcredit 金额库、CNY 换算、reservation ceil、settlement rounding 和
  overflow/underflow 测试。
- [x] 实现超级管理员调增/调减命令，要求 reason、idempotency key、expected account
  version；调减不得使 available 小于零。
- [x] 实现用户余额/冻结额/个人流水查询和超级管理员全局账户/调账审计页面。
- [x] 实现账本到余额投影重建与对账命令，证明缓存投影可从账本恢复。

验收门禁：并发调账与冻结不产生负 available；同键重放稳定、异载荷冲突；普通用户不能
读取他人账户；100 积分与 1 CNY 的所有边界换算可重算。

## Phase 5：模型调用冻结、结算与成本归因

目标：把钱包、价格快照与现有模型 invocation/usage 权威链连接起来。

- [x] 定义 Billing Port，绑定 AppScope、principal、run/conversation、datasource、model
  profile version、invocation id、价格版本、FX 版本和请求预算。
- [x] 在 provider 调用前解析可计费上限并原子创建 bill reservation + credit hold；余额或
  价格链不足时不创建真实 invocation。
- [x] 复用 `research_resource_reservations`、`research_invocation_commits` 和 immutable
  outcome usage，按实际维度结算并释放差额。
- [x] 处理成功、失败有 usage、取消未开始、outcome unknown、actual 超限和重复 terminal
  callback 的所有状态转换。
- [x] 实现 `SYSTEM_FUNDED` 超级管理员账单和 workspace/run/conversation 成本统计。
- [x] 先以 `SHADOW` 模式运行对账，验证无遗漏/重复后通过部署审批切换 `ENFORCED`。

验收门禁：任何真实普通用户 provider 调用前已有足额 hold；每个 terminal invocation 恰好
对应 `SETTLED/RELEASED/REVIEW_REQUIRED`；crash recovery 不重复扣费；账单快照可独立
重算；超级管理员账单不改积分余额。

## Phase 6：语义 JSON 导入导出

目标：提供安全、可迁移且不绕过治理的语义交换格式。

- [x] 在 contracts 定义 `semantic-workspace-export@1.0.0`、数据源逻辑引用、内容哈希和
  各导入状态 DTO。
- [x] 实现当前 published release 导出，验证不含 workspace 标识、SecretRef locator、
  凭证和成员/审核身份。
- [x] 实现上传限额、schema/hash 校验、持久化导入任务和显式 datasource mapping。
- [x] 实现 `READY -> DRAFT_CREATED` 原子命令，生成 import receipt 和 audit，并接入现有
  semantic governance。
- [x] 增加导入预览、映射、暂停/继续、失败原因和导出入口。

验收门禁：恶意/超限/未知版本 JSON 失败关闭；映射不能跨 workspace；失败无部分草稿；
成功导入永远不是 published；导出再导入 round-trip 通过。

## Phase 7：完整管理界面、观测与上线门禁

目标：补齐可运营性并证明端到端行为。

- [x] 完成全局管理员的用户、工作空间、模型、价格、汇率、积分、账单和 review queue。
- [x] 完成工作空间成员、数据源、语义、对话、归因和成本视图；普通用户只看个人消费。
- [x] 增加结构化日志、失败同步/账务复核/余额异常指标与告警；日志统一深度脱敏。
- [x] 按用户要求以 route/component/PostgreSQL 自动化覆盖角色矩阵、工作空间切换、
  直接 URL 越权和长文本/移动端布局；浏览器只保留一张关键截图。
- [x] 运行 clean-install 重建演练、shadow billing 对账、回滚演练、备份恢复和安全审查。
- [x] 更新运维文档：首个管理员、用户停用、价格审批、积分调账、review 处理和灾难恢复。

验收门禁：PRD AC1-AC20 全部有自动化或明确人工证据；`pnpm lint`、`pnpm typecheck`、
`pnpm test:unit`、`pnpm test:contract` 和相关 E2E 全部通过；无 P0/P1 安全或数据完整性
问题后才启用 `ENFORCED`。

## 建议子任务映射

批准后创建以下子任务，并把当前任务保留为父任务和总体验收入口：

| 子任务 | 对应阶段 | 依赖 |
| --- | --- | --- |
| `workspace-identity-rbac` | Phase 0-1 | 无 |
| `workspace-data-isolation` | Phase 2 | identity-rbac |
| `model-price-fx-control-plane` | Phase 3 | Phase 0 contracts |
| `credit-ledger` | Phase 4 | identity-rbac、price contracts |
| `model-billing-settlement` | Phase 5 | data isolation、price-fx、ledger |
| `semantic-json-portability` | Phase 6 | data isolation、identity-rbac |
| `workspace-admin-operations-ui` | Phase 7 | 上述全部 |

## 需求追踪

| PRD 范围 | 主要交付阶段 | 最终验收 |
| --- | --- | --- |
| R1-R7.6 工作空间、数据源与语义可移植性 | Phase 1、2、6 | AC1-AC4、AC10、AC12、AC18、AC20 |
| R8-R13.2 用户、角色与权限 | Phase 1、7 | AC2、AC5、AC11、AC12、AC17 |
| R14-R25 积分冻结与模型结算 | Phase 4、5 | AC6-AC9、AC13、AC14、AC19 |
| R26-R29.3 官方价格与汇率 | Phase 3、5 | AC7、AC15、AC16 |
| R30-R33 无支付人工调账 | Phase 4、7 | AC6、AC9、AC17 |

## 回滚边界

- 身份/RBAC 上线失败：保留新 schema，回退应用版本；不得重新开放匿名旧 API。
- 数据 repository 切换失败：在单一发布窗口回退到只读旧路径；禁止长期双写后猜测真值。
- 价格同步失败：停 worker，保留最后 active 版本。
- `SHADOW` 计费异常：不进入 `ENFORCED`，修复并重放 shadow 对账。
- `ENFORCED` 后账务异常：停止新的普通用户模型授权，保留查询和管理员审计；不得批量直接
  改余额，修复必须通过补偿账本条目。

## 计划完成定义

父任务只有在全部子任务完成、迁移与回滚证据齐全、PRD AC1-AC20 全部满足、shadow
账单与实际 usage 对账通过，并由超级管理员显式启用 enforced billing 后才能结束。

## 2026-08-15 最终验收进度

- AC1-AC20 的功能证据已通过 contracts/platform/Web/PostgreSQL 自动化与关键截图复核。
- `pnpm test:unit`、`pnpm test:contract`、Next.js production build、Supabase static check、完整
  PostgreSQL smoke 与 release drill 通过。
- 当前共享工作区中，全局 `pnpm typecheck` 仅被另一个未跟踪 eval 测试的
  `attempt_index` 类型错误阻断；全局 `pnpm lint` 被其他未提交文件阻断。本任务
  237 个干净已跟踪文件的 Biome 门禁通过。
- 因最后仓库门未全绿，`workspace-admin-operations-ui` 与父任务仍保持
  `in_progress`，本地部署保持 `SHADOW`，未启用 `ENFORCED`。
