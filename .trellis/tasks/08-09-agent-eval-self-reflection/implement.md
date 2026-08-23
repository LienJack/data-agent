# 能力测试模块实施计划

> 执行中。已交付 BIRD Mini-Dev 10 题、InsightBench 5 题与认证模型 Agent 的失败关闭接入；
> 2026-08-10 新增环境系统模型、七题库接入和独立 Holdout 80% 目标。异步调度与未完成题库继续保持 HOLD。

## Phase -1. 环境系统模型

- [ ] 从仓库根 `.env` 安全读取 `DeepSeekAPIKey`/`KimiAPIKey`，映射到服务端 Provider Credential。
- [ ] 幂等生成 DeepSeek/Kimi 稳定系统 Profile；API 只返回脱敏字段并拒绝修改/删除。
- [ ] Settings/Q&A/Test Center 显示 Provider、Model、系统默认与可用状态。
- [ ] DeepSeek 作为初始 Test Center active Profile；开发环境显式做题时真实探测，生产继续要求持久化 Receipt。
- [ ] 单元测试证明缺 Key 不生成、重复初始化不重复、Key 不进入 JSON/日志、系统 Profile 不可删除。

## Phase 0. 版本与许可证 Gate

- [x] 固定 BIRD Mini-Dev、Dr.Spider、InsightBench 的来源提交/数据版本和下载 URL。
- [x] 逐项记录代码许可证、数据许可证、归属要求和再分发边界。
- [x] 对 DAB 建立 `LICENSE_BLOCKED` 条目；没有明确依据前不下载数据。
- [x] 为首个 BIRD Smoke Slice 冻结 10 题 Case 清单。
- [ ] 将 BIRD Smoke Slice 扩展到 30–50 题。

## Phase 1. 题库合同与持久化

- [x] 扩展 `@data-agent/contracts`：Catalog、DatasetSnapshot、BatchRun、CaseRun、Attempt、ReflectionReceipt、ImportReceipt。
- [ ] 明确 `EvalRun` 与 `EvalBatchRun` 的父子关系、状态机、Artifact Reference 和 Hash。
- [x] 定义 Case Run 与 Frozen Manifest，固定 Agent/Model/Prompt/Workflow/Oracle/Dataset 版本。
- [x] 增加 PostgreSQL append-only 权威表、RLS、索引、幂等键和迁移回滚说明。
- [ ] 写 Schema/serialization/authority/tenant isolation 单元测试；证明客户端或模型不能直接写入聚合 ScoreCard。

## Phase 2. 安全安装器

- [x] 实现固定来源、大小、SHA-256、许可证 Gate 和允许列表安全解包。
- [x] 数据安装到 Git 之外的 Benchmark 数据卷；保存文件清单和 Import Receipt。
- [x] 实现 install/status CLI；摘要漂移或版本未知时失败关闭。
- [x] InsightBench 支持 Web/CLI 自动下载固定 5 题、逐文件摘要校验和 Public/Sealed 隔离。
- [ ] 实现 update API 与中断恢复。
- [ ] 用恶意压缩路径、摘要错误、超限文件、缺许可证和中断恢复测试安装器。

## Phase 3. 首个真实 Adapter：BIRD Mini-Dev

- [x] 将固定 BIRD Case 转为 Public/Sealed Case 和 Frozen Manifest。
- [x] 在只读 SQLite Snapshot 上运行 Candidate/Gold SQL。
- [x] 实现结果规范化、NULL、数值容差、行顺序和超时处理。
- [x] 新 Test Center Oracle 产生真实 Verdict；旧占位 Runner 改为失败关闭 `INCONCLUSIVE`。
- [x] 新增 `benchmark:smoke`，执行一个应 PASS 和一个应 FAIL 的真实 Case。旧 `eval:smoke` 仍属 U7 发布门禁。

## Phase 4. 耐久单题/批量运行

- [ ] 复用现有 Queue、Lease、Fence、Checkpoint、Cancel 和 Event Store。
- [x] `POST /api/tests/runs` 同时支持单个和多个 Case ID。
- [x] 批次冻结完整 Manifest；Child Case 失败不阻断其余 Case。
- [ ] 批次调度展开为 Case × Repeat Cell；每个 Cell 使用独立 Workspace、Attempt、Run/Trace 引用和判分结果，错答不按基础设施故障自动重跑。
- [ ] 通过 SSE 持久化输出 Case/Attempt/Oracle/Reflection 阶段，支持 Replay/Last-Event-ID。
- [ ] 测试重复提交、Worker 崩溃接管、取消、部分完成和断线恢复。

## Phase 5. 测试模块 UI

- [x] 题库列表：卡片、版本、许可证、安装状态和能力信息。
- [x] 题目列表：勾选、全选、单题/批量启动。
- [ ] 题库最近成绩、题目分页与筛选。
- [ ] 单题页：配置、实时 Attempt、答案、SQL/工具回执、Verdict、Reflection。
- [ ] 参考 Penguin Case Browser 实现允许材料预览和 Evaluation -> Case -> Run -> Trace 下钻；Holdout Rubric/Gold 不出现在普通 API 响应中。
- [x] 批量页：同步 MVP 的真实逐题结果和错误分类。
- [x] InsightBench 页面支持自动导入、单题/批量自动分析、一次受约束反省与逐题规则分数。
- [ ] 异步进度、取消和断线恢复。
- [ ] 成绩单：First-pass、Post-reflection、Recovery、False-fix、成本/延迟/Token 和切片下钻。
- [ ] 成绩单保留 Penguin 风格的 Run Score/Cost/Duration/Trace，同时展示 Suite 原生指标、PASS/FAIL、有效样本与覆盖率；不同 Suite 不做无解释的直接平均。
- [ ] 覆盖 loading/empty/error/partial/stale/permission denied/cancelled 等状态和无障碍交互。

## Phase 6. Verifier-guided Reflection

- [x] 仅在 Agent 可归因 `FAIL` 后构造最小反馈 Envelope。
- [x] 生成结构化 `ReflectionReceipt`，不保存私有 Chain-of-Thought。
- [x] MVP 每题最多一次重试；不可归因失败不重试。
- [x] Attempt 0/1 分开计分，并计算 Recovery/Regression/Cost。
- [x] 建立 Baseline vs Reflection Candidate 的同 Case/同版本/同预算成对实验；Attempt 0/1 使用同一冻结 Manifest，浏览器 5 题实测首答 0%、反省后 20%。
- [ ] 验证 Reflection 无法读取 Gold/Holdout，且不能自动修改全局 Prompt/Skill/Memory。
- [ ] 将跨题 Agent 优化明确隔离为后续流程：版本快照 -> 假设 -> Candidate -> Tuning 评测 -> Holdout 验收 -> 人工接受/回滚；不得复用单题 Retry 接口直接改 Agent State。

## Phase 7. 第二、第三题库

- [ ] Dr.Spider：导入 Pair ID 和 17 类 perturbation，输出鲁棒性下降切片。
- [x] InsightBench：固定 5 题 CSV/参考洞察，规则指标作为 Smoke 判分权威；LLM Judge 不参与 PASS/FAIL。
- [x] InsightBench：认证模型 Agent 已通过 `AVAILABLE` Profile、PostgreSQL Certification Receipt、`ModelProviderPort`、已验证 Context/定价和成本上限失败关闭接入；LLM Judge 诊断分栏仍待实现。
- [ ] BLADE：基于 ODC-By 数据许可接入分析决策 JSON Validator。
- [ ] BIRD-Critic：许可证/真值获取闭合后，接入 PostgreSQL Lite Test Case Oracle。
- [ ] DAB：许可证闭合后先做小切片，不直接下载 PATENTS 等重数据。
- [ ] DataSciBench：逐数据项闭合许可，接入固定手动导入 Slice 与隔离 Python Validator。
- [ ] ScienceAgentBench：实现人工数据包导入、例外许可清单和无网络科学代码 Sandbox。
- [ ] SpreadsheetBench 2：实现固定 workbook Slice、文件级 Hash、隔离表格执行和 Soft/Hard Oracle。

## Phase 7.1. 七题库真实运行

- [ ] 每个题库至少冻结 5 个 Demo/Tuning 与 5 个未参与优化的 Holdout Case；不足时记录有效样本不足。
- [ ] 使用 DeepSeek 或 Kimi 完成首答，保存 Provider/Model/Profile/Prompt/预算与数据摘要。
- [ ] 错题执行一次 Oracle 引导反省；保存 Attempt 0/1、Failure Type、Recovery 与 Regression。
- [ ] 题库数据、Gold、Validator 与运行输出保持 Public/Sealed/Workspace 隔离。

## Phase 7.2. Agent 优化与 80% Gate

- [ ] 从 Tuning 错误聚类模型输出、Prompt/Workflow、工具/执行、Oracle/数据、预算和基础设施原因。
- [ ] 生成版本化 Candidate Prompt/Planner/Tool Policy，不修改 Oracle，不读取 Holdout Gold。
- [ ] 在相同 Tuning Manifest 上成对复测 Baseline/Candidate，拒绝成本越界或 Regression 恶化的 Candidate。
- [ ] 在完全独立 Holdout 上验收；每个有效题库 `valid_cases >= 5` 且 Post-reflection Pass Rate >= 80%。
- [ ] 未达 80% 的题库输出 HOLD、剩余错误簇和下一步，而不是删除失败样本或汇报混合平均。

## Phase 8. 发布验证

- [x] 本次改动的 Contract/typecheck/unit/scoped lint/Web build 通过。
- [ ] Fresh Benchmark Volume 从零安装并完成 BIRD 单题和批量 Smoke。
- [x] 浏览器 E2E 验证题库浏览、手工单题、批量和成绩单。
- [x] 有界面浏览器验证 Agent 目录与禁用态、InsightBench 5 题双 Attempt 批量运行、JSON 回执下载及 BIRD 单题 100 分回归；无控制台错误。
- [ ] 浏览器 E2E 覆盖取消、断线恢复和真实 Agent 错题反省。
- [x] 运行本地确定性 Baseline/Reflection Candidate 成对评测；5 题成绩单分别记录首答 0% 与反省后 20%，未把二次通过计入首答。
- [ ] 安全验证外部 Validator 无网络、不可写工作区、不可读取 Gold 目录。
- [ ] 以 Penguin 已验证的边界做差异回归：路径穿越/软链接逃逸被拒绝、运行前后冻结版本一致、Agent 错答与评测失败分离、Run 可深链到真实 Trace。
- [ ] 人工篡改或伪造聚合分数时，Aggregator 能从原子 Receipt 重建并拒绝不一致结果。
- [ ] 输出 Go/Hold 决策；没有真实签名结果时保持 `HOLD`。

## Expected Validation Commands

具体命令在实施前按当时 `package.json` 和 Next.js 本地文档复核，预期至少包括：

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm eval:smoke`
- 目标包的 scoped Vitest 命令
- 数据库迁移 clean-install + `ON_ERROR_STOP` + migration ledger 校验
- Web/Worker/PostgreSQL/Benchmark volume 分项 health probe
- 浏览器 E2E

## Rollback Points

- Catalog/Importer 可先交付为只读和 `NOT_DOWNLOADED`，不启用运行。
- BIRD Adapter 可由 Feature Flag 控制，失败时保留现有 `HOLD`，不回退为占位 PASS。
- UI 路由可独立关闭，不删除历史 Eval Artifact。
- 题库版本升级新增 Snapshot，不覆盖或删除旧数据与成绩。
