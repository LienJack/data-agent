# C7 b818da8d 单次结果与未解析语义契约修复

## 实际运行边界

2026-08-31，clean source `b818da8d6e42e7a9dd5312187bee490c8d56ead0`，独立 NAS scratch
`data-agent-falcon24-e17-b818da8d`（55478）。force build 8/8、unit task 15/15
（14 cached，fresh Worker 97 tests）和 attestation 通过；不是全量 fresh test 声明。
generation hash `sha256:75b3e5e3d3364589369bada996be19774b188a49c9111a126c40ada53e585a25`。
baseline `4aff418e-f814-5295-9d33-470a134b9cc0` 仅在 scratch 激活，生产隔离仍 HOLD。
所有观察 non-scoring，不是正式四层 PASS。

同 Conversation `544b1a14-cf99-4245-b3b1-a22a6ebfaa4c`：

| 次序 | 一次提交的真实 Run | 结果 |
| --- | --- | --- |
| 1 趋势折线图 | `d72d5ed0-0332-8cd2-9b55-d5b5553c3e72` | SUCCEEDED；业务及 same-Run QA/Trace 通过 |
| 2 只看华东 | `442fa083-0bf5-8553-99a8-6fb72b3a2996` | FAILED；保留失败，未执行后续题或 UI 门禁 |

首轮真实 Semantic → Text2SQL → Analysis，12 行来源数据、两份 LINE 图与引用闭包一致。
报告已明确“数据源货币，具体货币未指定”，章节标题为“分析任务”，不再把委派目标标作原用户问题。
业务通过后打开 exact Run 的全部 99 个 Trace 节点详情、5 份 accepted Artifact，核对 hash、
Team/SQL tabs、刷新/返回、表格行数和画布状态；没有浏览器 console error。
独立 numeric helper 验证源值、S/tau/Z/slope 和两个月环比；p 值不属于该 helper 的独立证明。

第二轮冻结历史 3 条顺序及内容正确；追加消息后只读重验首轮仍一致。Root 四次选择 Semantic，
每次以 `MODEL_STREAM_PROTOCOL_VIOLATION` 失败，最后 `ROOT_AGENT_TURN_BUDGET_EXHAUSTED`。
无 accepted Artifact、无答案；历史 failure 不能改成 PASS。未读取到失败 provider 的原始文本，
所以不能声称它实际返回了零候选，也不能把下述合同缺口说成唯一已证线上根因。

不可变审计：`/Users/lienli/.codex/audit/falcon24-e1-authority-reset/c7-b818da8d/turn-01/`
的 submission / terminal-observation / oracle-numeric / business-review / result；
同目录 turn-02 的 submission / terminal-observation。live before/clone/after 共 348 表指纹完全相同。
本轮 Web/Worker/OpenSandbox 与认证浏览器已关闭，55478 转发取消，本地临时 capability 删除；
scratch 容器停止、volume 及历史保留，未退出共享 SSH master、未重启 OrbStack。

## Bug Analysis: 未解析映射没有安全协议出口

### 1. Root Cause Category

- Category: B Cross-Layer Contract + E Implicit Assumption。
- 独立可复现：旧 intent 不允许完全空选择，unresolved 却要求至少两个 candidate。
  无法在不编造对象的前提下表示“当前范围没有安全映射”。Prompt 还笼统排除 exact-term miss。
- 真实 failure 的候选解释包含 provider 输出格式、token/transport、合同缺口；
  确定性反例提高了合同缺口的可信度，但原始失败输出缺失，不能排除其他解释。

### 2. Why Fixes Failed

没有重复提交模型来试运气。先观察零候选合同、Semantic Tool round-trip 与 Prompt 用例失败，
再做兼容扩展。首次 downstream 仍使用旧 Contracts dist，重建后才验证新合同。
一次测试期望错误地要求清空 mandatory relationship；修正测试为保留 exact frozen inference
closure，而非修改生产投影。无 request-scoped 操作继续省略 optional 字段以保留旧 hash 语义。

### 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
| --- | --- | --- | --- |
| P0 | Contract | 0 或至少 2 个候选；单个/重复/乱序/超界拒绝，hash tamper 拒绝 | DONE |
| P0 | Producer/Host | 无安全映射可如实 unresolved，保留已知 closure，不造公式或候选 | DONE |
| P0 | Execution | Text2SQL 在 schema/datasource/Secret/connect 前拒绝 unresolved | DONE |
| P0 | Root/Answer | 引用 exact unresolved Artifact 后澄清，不宣称无数据或全局无定义 | DONE |
| P1 | Real proof | 新 clean build 单次轻量查询、澄清、再查询与 same-Run UI | PENDING |

### 4. Systematic Expansion

合同负结果必须同时贯穿 Provider、Artifact、Root 决策、SQL 防线与公开渲染。
请求内派生式可执行不等于已发布公式；缺映射也不等于返回 0 行。旧 valid payload/hash 不改，
新 producer/consumer 必须在同一冻结构建。此次没有 migration、live 写入、绕过权限或增大重试预算。

### 5. Knowledge Capture

- [x] 更新 backend/agent-team-runtime.md 的零候选语义、pre-I/O 拒绝与证明边界。
- [x] 更新 guides/cross-layer-thinking-guide.md 的安全负结果检查。
- [x] C7 当前缺陷及下一次单链路验收纳入现有子任务，不创建第二套任务/发布权威。
- [x] 检查模板同步：本仓库无 `src/templates/markdown/spec/`，不凭空新增 Trellis 模板树。
- [ ] 新运行的真实业务与 UI 结果；不得由上述 focused tests 冒充。

修复验证：Worker Team/Analysis/Provider 48 files / 517 tests；补充多候选公开渲染回归后，
Worker Tool/Answer 2 files / 100 tests；Contracts SemanticQueryContext 30/30、Root Harness 8/8。
Contracts/Agent Runtime/Worker typechecks、10 个变更源码/测试文件 Biome、`git diff --check` 通过。
