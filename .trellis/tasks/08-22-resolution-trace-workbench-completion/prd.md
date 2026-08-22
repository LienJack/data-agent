# 运行轨迹工作台完整验收补齐

> 上游需求：`.trellis/tasks/archive/2026-08/08-22-resolution-trace-workbench/prd.md`。
> 本任务不缩减或替换上游 R1-R44 / AC1-AC18，只记录当前证据与剩余实施。

## 1. Goal

让上游 PRD 的 18 条验收标准全部获得与其范围匹配的当前代码、自动化测试、数据库权限和真实浏览器证据。
已有 `37d103d` 只视为第一阶段纵向切片，不作为未覆盖需求的完成证明。

## 2. 完成性审计基线

| AC | 当前证据 | 审计结论 | 本任务动作 |
| --- | --- | --- | --- |
| AC1-AC3 | 四泳道、统计、1440/390 截图、状态形状 | 基本实现，证据需固化 | 增加十类型/全状态自动化与浏览器断言 |
| AC4-AC7 | 选择、拖选、搜索、摘要折叠 | 部分实现 | 补键盘邻接、双向滚动、真实 edge 层级和折叠行为测试 |
| AC8 | Tool/Agent 详情与五页签 | 节点类型覆盖不足 | 为十类节点、Config 与 Artifact 建立严格详情 fixture 矩阵 |
| AC9 | Event/Tool/Artifact/SQL 内容化 | 不完整 | 补 Run/Conversation/Config、Team Task/Handoff/Epoch/Verifier、Context 可用性内容；裸 ID 收进来源区 |
| AC10 | Effective Config exact receipt、Profile hash match | 证据不足 | 加 Catalog 改名不影响历史详情的回归测试；无冻结名称时稳定 unavailable |
| AC11-AC13 | 复用 Artifact Workspace exact preview | 已有能力但跨入口证据不足 | 复跑五 renderer、分页、漂移/权限/错误并验证 Trace 入口 exact ref |
| AC14 | QA SSE replay/assembler 与 trace refetch | 焦点/缓存恢复未证实 | 建立 baseline + append + reconnect + refresh 等价 fixture，验证不抢历史选择 |
| AC15 | 10k 纯模型和时间轴采样 | 浏览器 DOM 证据不足 | 10k 浏览器 fixture 验证列表与时间轴 DOM 上限、搜索和选择 |
| AC16 | owner route、既有 admin event/artifact audit | Resolution Trace admin 证据不足 | 证明或补齐跨 owner detail/content exact identity 与不可变 receipt，普通用户拒绝 |
| AC17 | 通用状态渲染 | 状态矩阵不足 | 覆盖 loading/empty/running/waiting/failed/cancelled/completed/reconnecting/time-missing/forbidden |
| AC18 | 仅行为参考 Harness | 已满足 | 保留原创实现证据，不引入未登记复制源码 |

## 3. Requirements

- 继承上游 R1-R44，任何实现或测试不得把未公开内容、当前 Catalog 猜测值或 raw authority document 当成历史事实。
- `ResolutionTraceDetail` 对所有节点提供同一 Run/Conversation 的内容优先上下文：问题、权威状态、创建/更新时间、attempt、当前冻结 Provider/model/config；Conversation 有权威绑定时提供标题与返回动作。
- Config、Datasource、Policy、Schema、Context 等只有 exact historical identity 而没有冻结显示名时，主视图必须明确
  `HISTORICAL_DISPLAY_NAME_UNAVAILABLE`，不能静默只显示 UUID/hash。
- Team Trace 公共投影必须使用已校验 authority document 中的 allowlist 字段，展示 Task 的公开阶段/摘要/时间、输出 Artifact，Handoff 关系、Context Epoch 公开计数/phase、Verifier 维度与 acceptance verdict/reason；Prompt、raw context、capability、SecretRef 不得出现。
- 普通 owner detail 与管理员跨 owner audit 必须是两条不同授权路径；管理员读取必须生成与 exact run/node/artifact 绑定的不可变 receipt。
- 10,000 节点时完整模型、搜索与 exact selection 保留，记录 DOM 和时间轴 DOM 都有严格上限。
- REST baseline、SSE append/replay、刷新必须生成相同 record identity、排序和 terminal 状态；用户查看历史、搜索或 Inspector 时不得被新事件抢焦点。

## 4. Acceptance Criteria

- [ ] 上游 AC1-AC18 全部在 `completion-audit.md` 中列出权威证据，状态均为 PASS；不得以“未发现问题”代替证据。
- [ ] 新增/修改合同均 strict parse、hash/identity closed、forbidden-key tested；未知字段失败关闭。
- [ ] Owner、admin、forbidden 三套 API/权限测试覆盖 detail 和 Artifact 内容路径，admin 返回 immutable audit receipt。
- [ ] 10k 浏览器验收证明记录 DOM <= 80、时间轴 DOM <= 1,200，搜索能定位尾部 exact node。
- [ ] 1440px 与 390px 实际页面完成搜索、时间轴选择/拖选/缩放/平移/重置、Inspector 五页签/resize/close/focus、内容预览和零 document overflow。
- [ ] Contracts、Agent Runtime（若合同受影响）、Platform、Web 的相关测试/typecheck/build、Biome、migration assertions 与 `git diff --cached --check` 通过。
- [ ] 只提交本任务拥有路径，保留共享工作树中的生成物、Falcon 产物和其他 Trellis 任务。

## 5. Hard Boundaries

- 不新增 UI 直读 `resolved_context_receipts`、Team raw JSON、Provider payload 或当前 Resource Catalog 的捷径。
- 如果完成 Context/Team 公共内容需要 Authority 变化，使用 forward migration + strict RPC + tests；不修改历史 migration。
- 不展示 chain-of-thought、系统 Prompt、凭据、SecretRef、连接串、完整未授权 stdout/rows。
