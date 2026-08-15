# Agent 原生 Node/Edge 语义图实施计划

## 1. 执行原则

- 父任务只负责跨层设计、子任务顺序、最终一致性和用户验收；实现按五个子任务分别启动、
  验证、提交和归档。
- 每个子任务开始前执行 `trellis-before-dev`，读取本 PRD/设计、子任务文档和对应 layer spec。
- 每个子任务只提交自己拥有的文件，不纳入当前工作树中其他未提交修改。
- PostgreSQL migration 编号在实施当日通过目录预检分配；本文使用
  `NEXT_SEMANTIC_GRAPH_MIGRATION`，不预占可能与并行工作冲突的固定编号。
- 先建立 Graph v2 的权威合同和兼容编译，再接 Agent/读取/UI；不先做一套只能展示的假图。

## 2. 阶段和提交边界

### Phase 0 — 启动门禁

- [ ] 用户明确批准本次最终规划摘要。
- [ ] 确认父任务仍为 `planning`，五个 child 均已建立且 parent link 正确。
- [ ] 运行 `git status --short`，记录并排除所有并行修改。
- [ ] 逐个补齐/复核 child 的 PRD、design、implement；只启动当前要执行的 child。
- [ ] 为当前 child 配置精确 scope、related files 和验证命令。

回滚点：未通过门禁时不运行 `task.py start`，不改产品代码。

### Phase 1 — Graph v2 合同、编译器与持久化

Owned task：`08-15-semantic-graph-v2-core`

#### 1.1 合同与 fixtures

- [ ] 在 `packages/contracts` 新增 `SemanticGraphSource@2`、Node union、Edge/registry、Formula AST、
  graph patch、validation/diff 合同和 stable public errors。
- [ ] 为 Node intrinsic-only 约束、Edge endpoint registry、AST slot binding 建立 strict Zod fixtures。
- [ ] 保持 `SemanticSourceBundle@1`、现有 Explorer/Relationship contracts 向后兼容；新增版本而非
  就地改变历史 schema。

#### 1.2 PostgreSQL authority

- [ ] 预检 migrations，选择下一个可用编号。
- [ ] 增加 graph projection/node/edge、必要 release ref 和 registry/receipt 支撑结构；所有表带
  scope、RLS、唯一性、immutability 和 rebuild 元数据。
- [ ] 写 narrow RPC/service contract；禁止客户端直接写图表，禁止调用方传 principal/scope。
- [ ] 验证旧 release 行和 source digest 不变。

#### 1.3 Compiler 与 gate

- [ ] 实现 Graph v2 canonicalization/digest 和 intrinsic-only linter。
- [ ] 实现 Edge registry、悬空/重复/cycle/endpoint gate。
- [ ] 实现 Formula AST slot resolver、类型/unit/grain/filter/null/fanout gate。
- [ ] 实现 Graph v2 → `SemanticSourceBundle@1` 兼容编译和原生 graph projection。
- [ ] 建立等价正例、冲突负例、determinism 和 old-runtime regression fixtures。

#### Phase 1 验证

```bash
pnpm --filter @data-agent/contracts typecheck
pnpm --filter @data-agent/contracts test:unit
pnpm --filter @data-agent/contracts test:contract
pnpm --filter @data-agent/semantic typecheck
pnpm --filter @data-agent/semantic test:unit
pnpm --filter @data-agent/platform typecheck
pnpm --filter @data-agent/platform test:unit
pnpm test:tenancy
```

Go/No-Go：只有 Graph v2 fixture 可确定性编译为现有 runtime 投影、旧 release 不变且 migration
可重复执行，才进入 Phase 2。

### Phase 2 — Agent 语义创作工具循环

Owned task：`08-15-semantic-agent-authoring-runtime`

#### 2.1 Additive AgentTurnPort

- [ ] 新增支持 assistant tool-call / tool-result 历史的一轮端口，不改变现有 ModelProviderPort 行为。
- [ ] 在 Mastra/provider adapter 中保持 `maxSteps=1`，只产出 tool-call candidate，禁止 provider
  execute。
- [ ] 复用认证模型、billing、provider policy、redaction 与 stable terminal。

#### 2.2 Authoring run 和工具

- [ ] 增加 authoring run command/kind、checkpoint、clarification/resume 和 explicit complete。
- [ ] 实现只读工具与 candidate-only Node/Edge/edge-type/validate/impact 工具。
- [ ] mutation 使用 expected revision + idempotency receipt + CAS；每次只做一个原子 reducer。
- [ ] 工具 policy 明确 deny approve/publish/rollback/secret/raw SQL/Neo4j/network。
- [ ] 每轮动态读取当前 candidate、选区和最小可见邻域；不把全图加入 prompt。

#### 2.3 公开事件与恢复

- [ ] 扩展 durable run events：stage、tool terminal、typed graph patch、validation、clarification、terminal。
- [ ] Worker 实现 crash recovery：已提交 receipt 不重复 mutation，缺失 event 可补写/重放。
- [ ] SSE 继续支持 cursor/Last-Event-ID、sequence dedupe、heartbeat 和 terminal close。
- [ ] 审计保留原始用户意图与公开 evidence，不记录 CoT、system prompt、secret 和 raw provider error。

#### Phase 2 验证

```bash
pnpm --filter @data-agent/agent-runtime typecheck
pnpm --filter @data-agent/agent-runtime test:unit
pnpm --filter @data-agent/agent-runtime test:contract
pnpm --filter @data-agent/agent-runtime test:security
pnpm --filter @data-agent/semantic test:unit
pnpm --filter @data-agent/platform test:unit
pnpm --filter @data-agent/worker test:unit
pnpm --filter @data-agent/worker test:integration
```

必须新增集成测试：multi-tool success、needs clarification/resume、stale revision、tool budget、
provider timeout、crash after commit、event reconnect、explicit-complete missing、publish tool denied。

### Phase 3 — 统一读取模型、局部图和全图投影

Owned task：`08-15-semantic-graph-read-models`

#### 3.1 Read APIs

- [ ] 实现 paginated Node List、Node/Edge detail、bounded neighborhood、shortest visible path、impact、
  candidate diff 和 cluster hierarchy 合同。
- [ ] 统一 release projection + candidate overlay identity/status；四个视图不得分别解释对象。
- [ ] 扩展现有 relationship search，Neo4j/index 只返回 key，PostgreSQL 重新授权与 hydration。

#### 3.2 Community 与布局

- [ ] 实现 release-bound、content-addressed community hierarchy 和 deterministic seed。
- [ ] 聚类输出包含可解释 node/edge/type counts、member digest 和 algorithm version。
- [ ] candidate overlay 暂挂发布 cluster 或“候选变更”cluster，不同步重算全图。
- [ ] 实现投影 rebuild/compare/health，索引不可用时降级 PostgreSQL read。

#### 3.3 预算与安全

- [ ] Local graph 强制 250 Node/500 Edge，并返回 truncation/continuation/aggregate。
- [ ] Full graph 每层强制最多 500 glyph，按 hierarchy 分层取数。
- [ ] 聚合计数、路径和 community 对不可见对象执行相同过滤，防止侧信道泄漏。

#### Phase 3 验证

```bash
pnpm --filter @data-agent/contracts test:unit
pnpm --filter @data-agent/semantic typecheck
pnpm --filter @data-agent/semantic test:unit
pnpm --filter @data-agent/platform test:unit
```

增加 10,000 Node benchmark、projection rebuild equivalence、candidate overlay consistency、scope/RLS
负例和 Neo4j unavailable 降级测试。

### Phase 4 — Semantic Studio 图编辑体验

Owned task：`08-15-semantic-studio-graph-ux`

#### 4.1 Studio shell 和共享 store

- [ ] 把 `/semantic` 变为 Studio shell，默认 Node List，保留 Review/Version/Lineage 入口。
- [ ] 建立一个按 release/candidate key 的 normalized graph store；List/Local/Full/Diff 共享 identity、
  selection 和 status tokens。
- [ ] Node List 实现服务端筛选、搜索、排序、分页/虚拟化；行内只显示固有摘要和关系计数。

#### 4.2 Local / Full graph

- [x] 使用 AntV G6 v5 改造 local graph 消费 Graph v2 store，支持 1-hop/2-hop、direction、
  truncation 和无障碍 table fallback。
- [x] 使用 AntV G6 v5 client-only adapter，按 cluster hierarchy semantic zoom，提供缩放、拖拽、
  Minimap、选择和稳定服务端初始位置。
- [ ] 补齐 cluster 收起、最短路径高亮与 500 glyph / 10k benchmark；搜索、筛选、回到当前选择
  和 candidate overlay 已接入共享 store。

#### 4.3 Persistent Agent Composer

- [ ] Composer 在三种创作视图间持久化，携带可删除的选区/viewport/release/candidate context。
- [ ] 所有 create/edit/link/unlink/rebind/retire UI 只聚焦 Composer 和填充意图模板。
- [ ] 移除 `physical-schema-browser` 的任意 operation JSON textarea/JSON.parse 提交路径。
- [ ] 订阅 durable events，按顺序应用 graph patch；刷新按 cursor 重放且 patch digest 去重。
- [ ] 展示公开 stage/tool/evidence/validation/clarification，不展示 CoT 或 secret。

#### Phase 4 验证

```bash
pnpm --filter @data-agent/web typecheck
pnpm --filter @data-agent/web test:unit
```

浏览器验收覆盖 desktop/mobile、键盘操作、颜色非唯一状态、断线恢复、1/2-hop、full graph 500
glyph、10,000 Node list、Agent mutation live overlay，以及“没有直接 JSON/拖拽写入”。

### Phase 5 — v1 迁移、治理与上线收口

Owned task：`08-15-semantic-graph-migration-rollout`

#### 5.1 Converter 与 dual compile

- [ ] 实现 v1 embedded fields → Graph v2 Node/Edge 的确定性 converter 和 migration report。
- [ ] 同稳定 identity 才复用；名称相似、关系方向、依赖或 binding 歧义进入 unresolved candidate。
- [ ] 对代表性发布 fixture 运行 v1/v2 dual compile，比较 runtime projection 和 query result。
- [ ] 证明旧 source/release/query run digest 不被修改。

#### 5.2 治理集成

- [ ] Review/validation receipt 绑定 exact Graph v2 candidate/base release/compiler/policy。
- [ ] stale-base/rebase、并发 publish、reject、rollback 和 active pointer 继续失败关闭。
- [ ] Query Grounding 只读 active release；candidate overlay 不进入运行时。
- [ ] 审计覆盖 prompt evidence、tool receipts、before/after/patch digest、validation 和 terminal。

#### 5.3 Feature flags、观测与回滚

- [ ] 按 read adapter → dual compile → allowlisted authoring → publish → full graph 分阶段启用。
- [ ] 增加 migration/projection lag、authoring failures、clarification、validation、SSE replay、community
  rebuild、stale candidate 指标与告警。
- [ ] 演练关闭 flags、继续服务 last active release、重建 graph/community/Neo4j 投影。
- [ ] 不使用破坏性 down migration；保留候选、revision、receipt 和旧 release。

#### 5.4 端到端业务验收

- [ ] 新增“成交商品数”：Metric + Formula + HAS_METRIC + DEFINED_BY + REFERENCES/DEPENDS_ON。
- [ ] 修改为“仅统计已支付订单”：Formula/Edge patch、影响分析和 live overlay。
- [ ] 新增“商品维度并绑定商品 ID”：只新增/复用 Node/Edge，migration ledger 无业务 DDL。
- [ ] 重名、未知列、含糊状态值、cycle、unit/grain、unsafe fanout 均澄清或失败关闭。
- [ ] 人工审核后才进入 active Explorer/Query Grounding；rollback 恢复上一 active release。

#### Phase 5 验证

```bash
pnpm typecheck
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm test:tenancy
pnpm test:security
pnpm build
```

再执行 PostgreSQL authority/RLS、Worker/SSE、浏览器 E2E、10,000 Node 性能和投影 rebuild 的
环境级验证；记录命令、版本、receipt/digest 与 Go/No-Go 结果。

### Phase 6 — Falcon 全量运行与最终完成门禁

依赖任务：`08-15-falcon-demo-eval`

- [ ] 只有 Phase 1–5 的语义层、Agent authoring、Studio 和发布治理全部通过后，才启动 Falcon
  最终验收；Falcon 不得反向绕过 active semantic release 或 sealed Oracle 边界。
- [ ] 按固定 Falcon 快照完成 28 个 PostgreSQL schema 的导入、摘要、行数、权限和幂等回执验证。
- [ ] 以 db24 作为多表主 Demo，db14 作为 smoke；完成语义发布、Workspace datasource、真实
  Agent/Worker、PostgreSQL executor、严格 Oracle 和浏览器客户路径。
- [ ] 跑通单题、db14 32 题、主 Demo 全量题、DEV 309 题与 TEST 191 题 submission；TEST 只生成
  提交产物，不伪造本地准确率。
- [ ] 执行项目中所有 Falcon 相关 contract/unit/integration/tenancy/security/browser 测试，以及真实
  migration/import/Worker run；任何失败均阻止父任务完成。
- [ ] 保存 ScoreCard、失败分类、submission receipt、服务健康、浏览器截图和可复现 runbook 证据。

最终 Go/No-Go：只有语义层 Phase 1–5 全绿，且 `08-15-falcon-demo-eval` 的全量数据、运行、评测、
提交与浏览器验收全部通过，才能把本父任务标记为完成。Falcon 任一范围未跑、未完成或失败时，
父任务保持 `in_progress`。

## 3. 跨子任务接口冻结点

为减少并行返工，在下列点显式冻结：

1. Phase 1 完成：冻结 `SemanticGraphSource@2`、Node/Edge/AST/patch/error 合同。
2. Phase 2 完成：冻结 authoring run 状态、tool descriptor/result 和 public event 合同。
3. Phase 3 完成：冻结 Node List/local/full/diff 读取合同与预算字段。
4. Phase 4 完成：冻结用户流程、视觉状态和无直接写入行为。
5. Phase 5 只修兼容/治理/性能缺陷，不无评审地扩大 Graph v2 类型或 Agent 权限。

任何冻结后 material contract change 都要更新父/子设计、重新运行受影响回归；若改变用户可见
行为或 Authority，重新提交用户审阅。

## 4. 风险文件和隔离策略

- 高风险合同：`packages/contracts/src/artifacts/semantic-governance.ts`、
  `semantic-explorer.ts`、`semantic-candidate-generation.ts`、run public events、model-provider ports。
- 高风险 runtime：candidate reducer/compiler、Mastra execution bridge、tool policy、worker run loop。
- 高风险数据库：semantic release/candidate/revision、run events/outbox/receipts、RLS/RPC migrations。
- 高风险前端：`/semantic` routes、review workspace、physical schema browser、relationship graph/store。

策略：优先新增 versioned files/adapters，再最小改动现有 exports；每个阶段运行 package-local 测试后
再运行 cross-layer。遇到并行改动时不回滚、不覆盖，缩小 patch 或停止并报告冲突。

## 5. 最终验收矩阵

| PRD 验收 | 主要阶段 | 证据 |
| --- | --- | --- |
| AC1 Graph model | 1、5 | schema fixtures、compiler/gate、DDL audit |
| AC2 Agent authoring | 2、5 | tool-loop receipts、negative policy tests、E2E |
| AC3 Frontend views | 3、4 | browser tests、shared-store consistency、replay |
| AC4 Governance/compatibility | 1、2、5 | release digest、RLS、stale/publish/rollback tests |
| AC5 Scale/consistency | 3、4、5 | 10k benchmark、250/500/500 budgets、projection compare |

## 6. 任务完成条件

- 五个 child 均独立验证、scoped commit 并归档。
- 父 PRD AC1–AC5 全部有可复现证据，不以截图或 Agent 自述代替 authority/receipt/test。
- 无未提交的本任务文件；不包含其他工作树改动。
- 相关 spec 记录 Graph v2 authority、Agent tool loop、public event 和前端 graph store 新约定。
- 父任务完成最终集成 review、rollback 演练、用户验收摘要和 scoped commit 后才归档。
