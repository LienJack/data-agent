---
date: 2026-08-05
topic: datafoundry-platform-modules
---

# DataFoundry 风格平台模块 — 需求文档

## Summary

在现有 Data Agent 分析工作台的基础上，新增 Data Sources 数据源管理、Data Link 语义层浏览/编辑、Agent Q&A 对话交互、Model 选择四个核心模块，采用渐进式分期构建，将导航从顶部标签栏改造为左侧侧边栏，最终形成类似 DataFoundry 的一站式数据智能平台。

**2026-08-05 goal update:** 用户追加目标：LLM model 需要接入多个，参考 DataFoundry、WrenAI、text2sql、DB-GPT。已确认采用 Provider 感知的模型配置 + Q&A 切换：Settings 支持多 provider 模型 profile，Q&A 选择模型并真正传入 run 链路。

**2026-08-06 visual goal update:** 用户提供 DataFoundry 工作台参考图。参考图只用于借鉴浅色三栏的信息组织，不复制其产品身份、模块命名或虚构运行数据。主分析界面必须结合本项目后端契约与业务：左侧组织归因分析、数据语义和治理入口，中间呈现 L2 报告候选与声明—证据，右侧展示由真实 `RunProjection` 派生的运行与证据轨迹，并明确区分工作流完成、评测结果和治理交付。

---

## Problem Frame

当前 Data Agent 是一个功能强大的分析工作台，具备 Text2SQL 多步研究、语义治理审核、SQL 沙箱执行等能力。但用户界面单一——只有"分析工作台"和"语义审核"两个页面，导航为简单的顶部标签栏。

对比 DataFoundry 等现代数据平台，缺少以下关键能力：

1. **数据源连接管理** — 用户无法从 UI 管理外部数据库连接，目前只有后端出站策略（`datasources/egress.ts`），配置门槛高
2. **语义层可视化** — 虽然有完整的语义治理审核流程（`packages/semantic`），但缺少语义定义的浏览和编辑界面，用户无法直观查看和管理指标、维度、表映射
3. **对话式交互** — 当前工作台的研究分析流程功能强大，但交互偏"提交分析→查看报告"的单次模式，而非持续的对话式问答
4. **模型选择** — 模型供应商固定，用户无法自由选择或配置自己的模型

这四方面能力的缺失，限制了 Data Agent 从"内部工具"向"面向多用户的数据分析平台"的演进。

---

## Actors

- A1. **数据分析师 (Analyst)**：日常使用平台进行数据查询和分析，需要对话式交互、多数据源访问、语义层辅助理解
- A2. **数据管理员 (Data Admin)**：管理数据源连接、配置模型、维护语义层定义
- A3. **审核人 (Reviewer)**：对语义变更进行治理审核，发布或回滚语义定义（已有，保持不变）
- A4. **Agent 系统**：自动执行 Text2SQL、研究分析、假设验证等工作流

---

## Key Flows

- F1. **连接数据源**
  - **Trigger:** 管理员点击 Data Sources → 添加连接
  - **Actors:** A2
  - **Steps:** 选择数据库类型 -> 填写连接配置（主机/端口/库名/用户名/密码/SSL） -> 测试连接 -> 保存 -> 连接出现在数据源列表
  - **Outcome:** 新数据源连接可用，Q&A 中的查询可引用该数据源
  - **Covered by:** R1, R2, R3, R4

- F2. **浏览和编辑语义层**
  - **Trigger:** 用户打开 Data Link 页面
  - **Actors:** A1, A2
  - **Steps:** 浏览语义模型列表 -> 查看模型详情（指标、维度、表映射、关系） -> 编辑语义定义 -> 提交变更 -> 自动进入治理审核流程 -> 审核通过后发布生效
  - **Outcome:** 语义定义更新，Q&A 查询使用新语义
  - **Covered by:** R5, R6, R7, R8

- F3. **Agent Q&A 对话式查询**
  - **Trigger:** 用户在 Q&A 页面输入问题
  - **Actors:** A1, A4
  - **Steps:** 用户输入问题 -> Agent 选择数据源和语义层 -> 执行 Text2SQL -> 展示结果（表格/图表/报告） -> 用户追问或修改 -> 对话持续
  - **Outcome:** 用户通过对话式交互完成数据分析，对话历史可回溯
  - **Covered by:** R9, R10, R11, R12

- F4. **配置模型**
  - **Trigger:** 管理员打开 Settings -> Model 配置
  - **Actors:** A2
  - **Steps:** 添加模型供应商 -> 填写 API Key + Base URL -> 测试连接 -> 保存 -> 模型出现在 Q&A 的选择器中
  - **Outcome:** 多个模型可供选择，用户可在 Q&A 中切换模型
  - **Covered by:** R13, R14

---

## Requirements

**[Data Sources — 数据源管理]**

- R1. 用户可以在 Data Sources 页面查看所有已配置的数据源连接列表
- R2. 用户可以通过表单添加新的数据源连接，支持 PostgreSQL 和 MySQL 两种数据库类型
- R3. 数据源连接配置包含：连接名称、数据库类型、主机、端口、数据库名、用户名、密码、SSL 选项
- R4. 数据源连接支持测试连接功能，验证配置是否正确

**[Data Link — 语义层浏览与编辑]**

- R5. 用户可以在 Data Link 页面浏览所有已发布的语义模型定义
- R6. 用户可以在 Data Link 页面查看单个语义模型的详情，包括指标定义、维度定义、表映射、关系
- R7. 用户可以通过编辑器创建新的语义定义或修改已有定义
- R8. 语义编辑提交后自动进入现有治理审核流程（review -> publish/rollback），审批后才生效

**[Agent Q&A — 对话式问答]**

- R9. Q&A 页面采用对话式交互：左侧对话历史列表，右侧对话区域
- R10. Q&A 页面集成现有分析能力（Text2SQL、多步研究、报告生成），复杂分析结果以卡片形式嵌入对话
- R11. Q&A 页面包含数据源选择器和模型选择器，用户可在对话中切换
- R12. 对话历史持久化存储，用户可以查看和恢复历史对话

**[Model 选择 — 模型配置]**

- R13. 用户可以在 Settings 页面配置模型，支持 OpenAI、Anthropic、DeepSeek、GLM、Kimi、Grok、Gemini 等 provider，每个模型 profile 包含 provider、modelName、baseUrl、API Key、active 状态
- R14. 模型配置支持管理多个 provider 的模型 profile，用户可在 Q&A 中切换，并将所选模型传入 run 链路实际生效

**[导航与布局]**

- R15. 导航从顶部标签栏改造为左侧侧边栏，容纳 Data Sources、Data Link、Q&A、Settings 等页面入口
- R16. 保持现有"分析工作台"和"语义审核"页面的功能完整性，将其融入新导航结构
- R17. 主分析页面采用浅色三栏工作台；报告与“运行与证据”面板必须从同一个 `RunProjection` 派生，不得把客户端整理出的工件序列称为后端 DAG，且工作流完成或评测 PASS 不得覆盖 Core L2、Published F9、Fixture Evidence 的治理判定

---

## Acceptance Examples

- AE1. **Covers R1, R2, R4.** 管理员在 Data Sources 页面点击"添加连接"，选择 PostgreSQL，填写 host=db.example.com, port=5432, dbname=analytics, user=admin, password=***, SSL=require，点击"测试连接"，显示"连接成功"，点击保存，连接出现在数据源列表中。

- AE2. **Covers R5, R7, R8.** 用户在 Data Link 页面浏览语义模型列表，点击"销售额"模型进入详情页，编辑"月销售额"指标的定义公式，提交变更，页面提示"已提交审核"，审核人在语义审核收件箱看到该提案，审批通过后发布，语义定义生效。

- AE3. **Covers R9, R10, R11.** 用户在 Q&A 页面左侧选择"2025Q4 分析"对话，在右侧输入框输入"华南区上季度营收前 10 的产品"，Agent 展示结果表格，用户追问"加上同环比"，Agent 补充同环比数据，对话历史完整可滚动查看。

- AE4. **Covers R13, R14.** 管理员在 Settings -> Model 配置页面选择 Anthropic，自动填入 modelName=claude-sonnet-4-5 和默认 Base URL，填写 API Key=sk-ant-xxx，点击"测试连接"显示成功，保存后模型出现在 Q&A 选择器。用户切换该模型后提问，run 使用该 Anthropic 模型执行。

- AE5. **Covers R15, R16, R17.** 用户打开主分析页面后，同屏看到左侧业务能力与最近分析、中间 L2 报告候选、右侧可审计的运行与证据轨迹；折叠侧栏、切换面板标签、关闭并重新打开面板均可用。即使工作流为 COMPLETED 且分析评测为 PASS，只要治理状态为 HOLD，正文仍显示“当前交付决定：HOLD”。

---

## Success Criteria

- 用户可以在 Data Sources 页面完成从创建连接到测试连接再到保存的完整流程
- 用户可以在 Data Link 页面完成从浏览语义到编辑再到提审的完整流程
- 用户可以在 Q&A 页面通过对话式交互完成数据分析，复现当前分析工作台的核心能力
- 用户可以在 Settings 页面配置模型选择，并在 Q&A 中切换使用
- 现有"分析工作台"和"语义审核"页面的功能在新布局中不受影响
- 主分析页面在桌面端呈现稳定三栏布局，且报告、分析轨迹、回执和状态来自同一运行投影，不展示未由后端签发的 DAG、发布或行动结论

---

## Scope Boundaries

- 除 PostgreSQL 和 MySQL 外的其他数据库类型（ClickHouse、Doris、SQL Server 等）不在本次范围
- 非以上 provider 的模型供应商（如自定义 OpenAI 兼容端点可作为 OpenAI provider 的 baseUrl 配置）不在本次范围
- 数据库 Schema 自动发现/同步功能不在本次范围
- 数据源连接池管理、连接健康监控不在本次范围
- 语义层的自动生成（AI 辅助定义）不在本次范围
- 对话历史共享、导出、搜索不在本次范围
- 用户权限管理（RBAC）不在本次范围（保留现有权限体系）

---

## Key Decisions

- **渐进式分期构建：** 按 Phase 1 (Data Link 编辑器 + 布局改造) -> Phase 2 (Data Sources) -> Phase 3 (Q&A 对话页) -> Phase 4 (Model 设置) 的顺序推进，每阶段独立可验证
- **页面编辑器 + 治理审核：** 语义编辑采用页面编辑器，编辑后自动提交到现有治理审核流程，而非直接生效或文件式管理
- **对话式 Q&A 替换当前工作台：** Q&A 页面作为主入口，融合现有分析能力，而非新建独立页面与工作台并存
- **多 provider 模型配置：** 模型选择从 OpenAI 兼容接口扩展为 OpenAI、Anthropic、DeepSeek、GLM、Kimi、Grok、Gemini 多 provider 模型配置，复用 DataFoundry 的 model profile / 连通性测试 / 当前 profile 解析到 run 的模式
- **左侧侧边栏导航：** 借鉴参考图的侧边栏密度，但按 Data Agent 业务组织为归因分析、对话分析、数据源、数据语义、语义治理和模型配置
- **单投影双视图：** 中栏报告和右栏“运行与证据”只负责格式化同一个 `RunProjection`；治理状态保持独立权威，不能由工作流 COMPLETED 或评测 PASS 推导为发布成功

---

## Dependencies / Assumptions

- 现有语义治理审核流程（review inbox -> detail -> publish/rollback）保持完整，Data Link 编辑器复用其 API
- 现有 `packages/semantic` 的编译器、影响分析能力保持完整，编辑器的语义定义使用其格式
- 现有 `packages/text2sql` 的接地、门控、修复管道保持完整，Q&A 页面复用其能力
- 现有数据源出站策略（`datasources/egress.ts`）将在 Data Sources 模块中集成
- 对话历史存储使用现有 PostgreSQL 数据库复用运行存储机制
- 假设新页面不需要额外的数据库迁移，可通过现有数据表和 API 路由实现

---

## Outstanding Questions

### Resolve Before Planning

- （无 — LLM 多模型接入范围已确认为 Provider 感知配置 + Q&A 切换）

### Deferred to Planning

- [技术] Data Sources 的 credential 存储方案（加密存储 vs 环境变量 vs 外部密钥管理）
- [技术] Data Link 语义编辑器的具体编辑界面设计（类 SQL 编辑器 vs 表单式 vs 可视化拖拽）
- [技术] Q&A 对话历史的数据模型设计（与现有 run 机制的集成方式）
- [技术] 左侧侧边栏的响应式行为（窄屏折叠/隐藏策略）
- [技术] 多数据源在 Q&A 中的选择机制（对话级别 vs 查询级别）
