# Falcon24 语义生命周期与 Agent 分析验收

## Goal

把语义层从“发布后被 Text2SQL 精确词法使用”扩展为可治理、可检索、可推断、可迭代的完整生命周期，并以
`falcon_db_24`、`deepseek-v4-flash` 和五个综合经营分析问题证明 Agent 能够利用业务定义、公式、关系与血缘，生成并执行
受控 Python，最后由独立 Oracle 给出可复验结论。

## Product outcomes

- 语义生产：知识、Schema、现有 Published Release 与 Agent 推断形成统一的候选断言和 ChangeSet；只有确定性校验、人工审核与发布
  才能改变 PostgreSQL 权威版本，图与索引只做可重建投影。
- 语义消费：一次问题解析同时使用术语/别名、稀疏搜索、向量检索和类型化关系/血缘扩展，并记录检索、推断和截枝回执。
- 逻辑推断：公式依赖、指标归属、维度兼容、Join、时间窗口和数据质量限制形成必须保留的闭包；模型不能绕过冲突或把关联写成因果。
- Agent Python：五题每题都必须包含 DeepSeek flash 实际生成的 Python 节点，在无网络、无凭据、固定依赖的 Sandbox 内运行；失败最多一次
  非扩权修复。
- 可验收：五题都有独立、密封、版本化的 Oracle；正确的数据质量降级是通过，不由 LLM 自评覆盖。

## Requirements

### R1. Semantic production lifecycle

- 新增版本化 `SemanticAssertionCandidate@1` 与 `SemanticChangeSet@1`，区分知识证据、Schema 事实、当前语义事实和 Agent 推断。
- Candidate 支持身份归并、冲突、置信度、来源定位、类型化关系和 before/after digest；禁止直接改 Published Release。
- 发布前必须验证字段/类型、公式 AST、单位、粒度、时间语义、循环、Join fanout、权限和证据闭包。
- 人工审核冻结 exact Revision；发布、回滚、漂移影响和索引/图投影均有可审计回执。

### R2. Hybrid retrieval, expansion, reasoning and pruning

- 在 workspace/permission/published/time frontier 预过滤后，并行执行 lexicon/alias、sparse、vector、graph 四路检索。
- 使用确定性 RRF 融合；关系扩展最多 3 hop、80 nodes、160 edges，并按关系类型、方向、语义域、版本和权限限制。
- Formula、Join、lineage、time、policy、quality 和 selected knowledge evidence 的 mandatory closure 不得被 token 截枝。
- 返回 `SemanticRetrievalReceipt@1` 与 `SemanticInferenceReceipt@1`，包括候选来源、分数、扩展路径、规则、截枝与降级原因。
- Neo4j/vector 不可用时回退 PostgreSQL，但必须披露路线降级；不得返回 deferred 占位。

### R3. Semantic context and analysis program

- 唯一 `SemanticContextPackage@1` 承载检索/推断回执、mandatory closure 与分析能力；不包装或读取任何旧 Resolved Context 合同。
- 唯一 `AnalysisProgram@1` 支持多输入、多指标、依赖 DAG、数据质量节点、模型生成 Python 节点、Oracle 节点和公开结论节点。
- 所有分析绑定 frozen datasource/schema/semantic release/policy/model/runtime/frontier；漂移产生新 revision，不静默复用。
- 最终运行时只有一个语义解析入口和一个分析执行入口；旧合同、resolver、planner、reader、adapter、fixture 与 dead tests 必须删除。

### R4. Falcon24 semantic assets

- 数据源固定为 `falcon_db_24`。正式完整月 frontier 为 2024-10：18 月窗口 2023-05..2024-10；12 月窗口
  2023-11..2024-10。
- 语义资产覆盖 9 表、70 字段、客户/订单/商品/配送/反馈/库存/营销关系及五题所需指标、公式、时间语义和数据质量规则。
- `orders.total_amount` 是订单收入权威；订单明细金额不自动替代。`inventory` 是库存题主口径，`inventoryNew` 仅作敏感性检查，禁止自动 union。
- 注册日晚于订单、存储客户汇总漂移、订单头/明细金额不一致、一单一明细等异常必须进入分析限制与回执。

### R5. DeepSeek generated Python

- 测试模型固定 `deepseek-v4-flash`；每题至少一个 `MODEL_GENERATED` Python 节点，不能用模板节点冒充。
- Provider 只接收 bounded schema/semantic/analysis evidence，不接收原始全量行、密钥、DSN 或主机路径。
- Python 只允许注册分析库与固定随机种子；静态准入、runtime lock、resource budget、output schema、zero partial commit 和独立 Oracle
  全部通过才接受。
- 首次失败最多生成一次 scrubbed repair，输入、预算、profile 和能力不得扩大；再次失败为明确 HOLD/PARTIAL。

### R6. Five-question acceptance

- Q1：18 个完整月经营趋势；找出最大收入下降月；按客户类型、商品品类、支付方式分解，并用
  `buyers × orders_per_buyer × revenue_per_order` 做对称 Shapley 闭合。
- Q2：最近 12 完整月配送表现，6v6 比较；按时率与时长 p50/p90、低评分率；用带月份控制的 binomial GLM 检验延迟与低评分
  的关联，协变量包含 log 金额、品类和客户类型，只允许关联性表述。
- Q3：最近 12 完整月库存；高销量用类别内 P75；损坏恶化同时要求 Theil-Sen 正斜率与 last3 > previous9，并做 BH FDR；允许
  “无命中 + watchlist”。
- Q4：18 个月周粒度营销；按渠道/人群比较漏斗、投入、回报；业务增长使用 0-4 周 distributed lag、趋势/季节控制、HAC 和 FDR；
  禁止个人归因和因果措辞。
- Q5：取最新 12 个可完整观察 M0-M6 的注册 cohort（2023-05..2024-04）；先报告时序异常；总体结论必须 HOLD/不可靠，同时给出
  排除“首单早于注册”客户但保留未下单客户的敏感性结果。正确降级算 PASS。

### R7. Independent acceptance and release

- 建立 `falcon24-agent-analysis-suite@1`，public/sealed 分离，生产实现不得导入 sealed truth 或共用核心计算函数。
- 每题 Oracle 验证时间窗、数据质量披露、统计方法、数值不变量、措辞级别、生成 Python receipt 和输出 hash。
- 硬门槛为 5/5；每题有生成 Python；Web 全 Agent E2E 通过；冷/暖各三次连续运行 flake=0；任何硬门失败不发布。

## Constraints

- PostgreSQL Published Semantic Release/Resolved Context 是权威；Neo4j、向量和稀疏索引均为可重建投影。
- 不暴露 chain-of-thought、原始 provider payload、凭据、DSN、未授权行或密封答案。
- 在隔离 worktree 内完成原子跨层切换；不实现双读、兼容 adapter、旧入口 fallback 或并存 feature flag。失败时整体回滚提交/迁移。
- 配送与营销只报告调整后的统计关联，不声称因果。
- Text2SQL 消费者在同一次原子切换中改用唯一 `SemanticContextPackage`；索引可降级，语义合同和解析入口不可降级到旧实现。

## Acceptance Criteria

- [ ] U1 语义生产合同、候选/变更/验证/审核/发布投影闭环通过单元与契约测试。
- [ ] U2 四路召回、RRF、类型化扩展、强制闭包、推断和截枝回执通过 golden/metamorphic/fallback 测试。
- [ ] U3 Falcon24 Published 语义包和数据质量审计能确定性重建并覆盖五题所需实体、指标、关系与血缘。
- [ ] U4 DeepSeek flash 生成 Python 的 Provider、准入、Sandbox、一次修复和 Oracle 链完成真实或明确环境阻断的运行证据。
- [ ] U5 五题 suite 达到 5/5，且每题有独立 Oracle、生成 Python 证据、正确结论级别和完整限制披露。
- [ ] 同一 frozen input 重放得到相同规范化 plan/evidence/result hash；权限、版本或 frontier 漂移 fail closed。
- [ ] 公开 UI/事件只展示接受后的安全投影，刷新与 replay 状态一致。
- [ ] 依赖边界扫描证明不存在 ResolvedContextPackage/V2/V3、AnalysisPlan、旧 resolver/planner 的生产引用，不存在双读、兼容 adapter 或同义 fallback。
- [ ] 相关 package 单测、类型检查、跨层测试、`git diff --cached --check` 通过；所有任务改动以范围清晰的提交完成。

## Out of scope

- 自动发布未经审核的语义 Candidate。
- 给 Python 网络、包安装、系统命令、DSN 或任意主机文件访问。
- 把统计关联提升为因果结论，或因为五题 benchmark 通过而宣称所有业务问题已经 GA。
