# Conversational Root Harness 实施计划

## 执行规则

- 严格按 C0-C7 顺序；每包先写/运行聚焦失败测试，再实现并运行聚焦验证。
- 每包一个 scoped commit，只 stage 本包明确拥有的文件。
- 不 stage、覆盖、删除或 reset 父任务 W2/10783 的任何 dirty 文件。
- 不启动新 Docker 容器；优先使用纯单元/合同测试。真实运行若需要现有服务，只复用既有环境并先核验目标。
- 任一包的 authority、恢复或安全负例失败即停止该包，不以重复运行掩盖失败。

## C0 — Freeze and characterization

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

Implement ProviderTaskArtifact v2、repository frozen message read、context builder、provider message assembler 和 strict contract/store tests。验证排序、唯一 current message、later-message exclusion、new-conversation isolation、scope denial 和 prompt-injection role preservation。

Commit: `feat(agent-runtime): freeze conversation context for root`

## C2 — Bounded Root Tool Loop

把一次性 Root executor 演进为最多四轮：decision、admission、execution、observation、checkpoint、final verification。移除 `DIRECT_ANSWER_REVIEW` 专用阶段；恢复按 logical identities replay。覆盖 direct、single、serial、parallel、tool failure、verifier feedback、budget exhaustion、duplicate mismatch 和 crash windows。

Commit: `feat(agent-runtime): execute bounded root tool loops`

## C3 — SemanticQueryContext

新增合同、Artifact registration、Host projection 和 Semantic output；Agent Card 宣告输出。覆盖 metric/formula/dependency、dimension/grain、relationship/join/cardinality、time/restriction、ambiguity、semantic-only final、cross-release/schema/run denial。

Commit: `feat(semantic): publish root semantic query context`

## C4 — Optional Semantic to Text2SQL

Text2SQL Card 接受可选 SemanticQueryContext；delegation admission 与 prepare 重验 exact bindings，并限制 compiler context。覆盖 direct Text2SQL、with-context、out-of-range object、stale release、schema/datasource/run mismatch 和 pre-I/O rejection。

Commit: `feat(text2sql): consume semantic query context`

## C5 — Analysis and final projection

Specialist terminal 返回 Root observation；Root 可选择 Analysis/Report/Chart。Final verifier 绑定 current-Run accepted refs；Conversation 回写 answer/table/chart refs。覆盖不需要图、Analysis failure、unsupported facts、same-source Chart 和 terminal idempotency。

Commit: `feat(agent-runtime): continue root through analysis results`

## C6 — Long conversation compression

新增 ConversationContextSummary、budget selector 和 summary Artifact writer。覆盖 64/80+ messages、stable coverage hash、recent-pair retention、summary replay、concurrent append isolation、summary prompt injection 和 summary-not-evidence。

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
