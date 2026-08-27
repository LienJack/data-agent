# Conversational Root Harness 实施计划

## 执行规则

- 严格按 C0-C7 顺序；每包先写/运行聚焦失败测试，再实现并运行聚焦验证。
- 每包一个 scoped commit，只 stage 本包明确拥有的文件。
- 不 stage、覆盖、删除或 reset 父任务 W2/10783 的任何 dirty 文件。
- 不启动新 Docker 容器；优先使用纯单元/合同测试。真实运行若需要现有服务，只复用既有环境并先核验目标。
- 任一包的 authority、恢复或安全负例失败即停止该包，不以重复运行掩盖失败。

## C0 — Freeze and characterization

Status: completed in `15a85898`.

Owned files:

- 本任务 `task.json/prd.md/design.md/implement.md` 及父任务 child link。
- 当前缺陷 characterization tests only。

Tests:

- Provider request 只含 current question 的失败刻画。
- Subagent output 不会进入下一 Root turn 的失败刻画。
- Semantic → Text2SQL 被 input-artifact admission 拒绝的失败刻画。

Exit: red behavior 已观察并以显式 pending/failing characterization 固化；不修改 production implementation。

Commit: `test(agent-runtime): characterize conversational root gaps`

## C1 — Frozen Conversation Context

Status: completed in `4035be7e`.

Implement ProviderTaskArtifact v2、repository frozen message read、context builder、provider message assembler 和 strict contract/store tests。验证排序、唯一 current message、later-message exclusion、new-conversation isolation、scope denial 和 prompt-injection role preservation。

Commit: `feat(agent-runtime): freeze conversation context for root`

## C2 — Dynamic Agent Tool Loop

Status: completed in `fcbfa34f`.

把一次性 Root executor 演进为最多四轮：每轮 Root 只决定当前调用或最终回答；当前调用经 admission 后执行，Tool Result 返回下一轮，再 checkpoint。删除同轮上游选择器、完整链预声明和 Host 业务分层调度；跨轮只传已验收 `input_artifact_refs`，同轮只允许互不依赖调用并行。Root Provider turn 接回既有 audited invocation/ProviderResponseArtifact 权威，同 logical turn 重放读取持久化响应，未知投递结果 fail closed。移除 `DIRECT_ANSWER_REVIEW` 专用阶段；恢复按 logical identities replay。覆盖 direct、single、跨轮 serial、同轮 independent parallel、tool failure、verifier feedback、budget exhaustion、duplicate mismatch 和 crash windows。

Validation:

- Contracts: 95 files / 933 tests.
- Agent Runtime: 27 files / 168 tests.
- Evals: 13 files / 96 tests.
- Worker focused: 10 files / 53 tests.
- Platform migration contract: 1 file / 6 tests.
- Contracts, Agent Runtime, Evals, Worker and Platform typechecks.
- Migration 10784 render verification, workspace migration inventory and PostgreSQL assertion `BEGIN / DO / DO / ROLLBACK` on the existing shared development container.

Commit: `feat(agent-runtime): execute dynamic root tool loops`

## C3 — SemanticQueryContext

新增合同、Artifact registration、Host projection 和 Semantic output；Agent Card 宣告输出。覆盖 metric/formula/dependency、dimension/grain、relationship/join/cardinality、time/restriction、ambiguity、semantic-only final、cross-release/schema/run denial。

Status: completed on 2026-08-27.

Evidence:

- Contracts: 96 files / 938 tests; focused SemanticQueryContext/Product Artifact/Root Tool contracts: 3 files / 16 tests.
- Agent Runtime: 27 files / 168 tests, including immutable historical rev3 migration binding and current Semantic runtime rev4.
- Worker Team/Provider: 17 files / 76 tests (75 passed, 1 intentional characterization failure), including Host projection, semantic-only Root facts, current output verifier and same-turn independent calls.
- Evals: 13 files / 96 tests.
- Contracts, Agent Runtime, Worker, Evals and Platform typechecks; scoped Biome and `git diff --check`.
- Web typecheck remains independently blocked only by the frozen W2 repair现场 files (`bootstrap-falcon24-e1.ts` and `repair-falcon24-semantic-projections.ts`); C3 does not edit or stage them.

Commit: `feat(semantic): publish root semantic query context`

## C4 — Optional Semantic to Text2SQL

Text2SQL Card 接受可选 SemanticQueryContext；delegation admission 与 prepare 重验 exact bindings，并限制 compiler context。覆盖 direct Text2SQL、with-context、out-of-range object、stale release、schema/datasource/run mismatch 和 pre-I/O rejection。

Status: completed on 2026-08-27.

Evidence:

- Text2SQL Product Profile r5 accepts only optional `SemanticQueryContext`; normal `input_artifact_refs` admission and child-task bindings preserve the exact accepted reference, while direct Text2SQL remains valid.
- Production Team resolves and verifies the committed same-Run Semantic Artifact before semantic release loading; prepare then revalidates catalog membership, selected closure and physical bindings before schema/datasource lookup or target I/O.
- Compiler schema/semantic projections and the SQL relation firewall are narrowed to the accepted closure; target binding and `SqlArtifact` provenance bind its exact reference/hash.
- Contracts: 96 files / 939 tests; Agent Runtime: 27 files / 168 tests; Worker Team + Analysis: 38 files / 182 tests; Platform focused resolution trace: 1 file / 28 tests.
- Contracts, Agent Runtime, Worker and Platform typechecks passed; 14 scoped files passed Biome and `git diff --check`.

Commit: `feat(text2sql): consume semantic query context`

## C5 — Analysis and final projection

Specialist terminal 返回 Root observation；Root 可选择 Analysis/Report/Chart。Final verifier 绑定 current-Run accepted refs；Conversation 回写 answer/table/chart refs。覆盖不需要图、Analysis failure、unsupported facts、same-source Chart 和 terminal idempotency。

Status: completed on 2026-08-27.

Evidence:

- Root 的 Semantic → Text2SQL → Analysis → final 路径保持四个普通 turn；每个 turn 只产生当前一个 Tool Call，后继仅通过前一轮已验收 `input_artifact_refs` 消费真实 Tool Result，不预声明完整链，也不由 Host 调度业务后继。
- Analysis terminal output 已通过既有 Product Team acceptance 形成 Root observation；现有 governed runtime 保持 `QueryEvidence -> typed Arrow -> operator -> DerivedAnalysisEvidence -> AnalysisReport/Chart` 同源闭包。
- Conversation final projection 不再把 `tool_completed` 误当验收：仅在同 Run COMPLETED terminal 下，关联 exact `profile_id/task_id` 的后续 COMPLETED Agent status，回写规范排序的 `QueryEvidence/ArtifactWorkspaceDocument/AnalysisReport` refs；FAILED Agent、非完成 Run、私有/cross-Run refs 被排除。
- 新回答写入和 replay 恢复共用同一投影器；恢复时覆盖旧 metadata 的自报 Artifact refs，answer 仍由 Run ID 与 durable answer events 绑定。
- Focused tests: Web final-message projection/event assembler 17/17；Worker Root loop/verifier/Production Team/governed Analysis 23/23。覆盖 no-chart、Analysis rejection、unsupported/unaccepted/cross-Run facts、same-source Chart 和 terminal checkpoint idempotency。
- Worker typecheck passed after C5 changes。Web typecheck 仅仍被冻结 W2 现场 `bootstrap-falcon24-e1.ts`、`repair-falcon24-semantic-projections.ts` 的既有 hash template errors 阻塞；C5 owned Web files 没有 type error。Scoped Biome 与 `git diff --check` passed。

Commit: `feat(agent-runtime): continue root through analysis results`

## C6 — Long conversation compression

新增 ConversationContextSummary、budget selector 和 summary Artifact writer。覆盖 64/80+ messages、stable coverage hash、recent-pair retention、summary replay、concurrent append isolation、summary prompt injection 和 summary-not-evidence。

Status: completed on 2026-08-27.

Implementation boundary:

- 10785 只演进既有 ProviderTask commit/load authority：从 frozen EffectiveConfig + accepted message cutoff 选择最近 64 条；较早最多 48 条生成 summary，至少最近 16 条保留原文，并向前扩展 user 边界以保留完整 user/assistant pair。
- Summary 和 ProviderTask 同事务写入现有 Artifact Store；历史 v1 与无摘要 v2 只读重放，不原地改写。
- Worker 用 `summary.covered_messages + task.visible_messages` 对齐 lease refs；summary 仅作为 untrusted user context，不能进入 system 或 accepted evidence。
- 不执行迁移、不启动 Docker、不触碰专用 Falcon E3 数据库；先完成合同、静态迁移、Worker 与 Web evidence-projection 聚焦验证。

Evidence:

- Contracts: 97 files / 942 tests；ConversationContextSummary 覆盖 stable hash、frontier/duplicate rejection、ProviderTask exact scope/run/hash/non-overlap binding 和 client cannot provide summary ref。
- Worker Root/Provider focused: 9 files / 39 tests；覆盖 summary binding、单一 system message、prompt injection 保持 user role、summary coverage + raw visible refs 对齐 lease，以及 direct/audited dispatcher 路径。
- Platform/Provider focused: 8 files / 59 tests（含合同/Worker 交叉聚焦）和独立 10785 static migration 5/5；Web accepted Artifact projection 16/16，确认 ConversationContextSummary 不进入 answer evidence refs。
- Contracts、Agent Runtime、Worker、Platform typechecks passed；Agent Runtime 27 files / 168 tests。
- 10785 render/verify checksum passed，完整 rendered SQL 由 PostgreSQL 18 parser 成功解析为 21 statements；未运行 migration、未启动 Docker、未访问专用 Falcon E3 数据库。
- Scoped Biome、dependency boundary gate、预编排/完整链禁用扫描和 `git diff --check` passed。

Commit: `feat(agent-runtime): summarize bounded conversation history`

## C7 — End-to-end acceptance

在同一个 Conversation 真实执行：

1. 最近 12 个完整月订单收入趋势，按月并生成折线图。
2. 只看华东。
3. 为什么 11 月下降。
4. 不用图，给表格。
5. 订单和客户怎么关联。

检查每个 message/run binding、Root provider messages、tool loop、exact accepted Artifacts、SQL/QueryEvidence/Arrow/Analysis/Chart、final answer 和可用 Trace UI。新 Conversation 的省略追问必须澄清。再运行 contracts/agent-runtime/worker/platform affected tests、typecheck/lint 及 forbidden scan。

Commit: `test(agent-runtime): prove conversational root harness`

## Completion and parent resume

- 汇总 C0-C7 commit 与验证证据，确认 git status 只剩父任务原有 dirty files。
- 完成本 Trellis 子任务并恢复 `08-27-falcon24-e2-authority-evolution`。
- 从父任务 W2/10783 当前现场继续；不重建或丢弃既有工作。
