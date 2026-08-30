# Bug Analysis: SQL 时间选择与 null-window evidence 不一致

## 1. Root Cause Category

- **Category**: B — Cross-Layer Contract；D — Test Coverage Gap；E — Implicit Assumption。
- clean `506c3cb8` force build 9/9、full unit 15/15 后，从 live E12 物理克隆到 NAS 55465；backup manifest 与
  9 表/70 列/121445 行原 dataset proof 相同。正常认证/Finalizer 只激活 scratch E13，live 未变。
- 一次 composer 创建 Conversation `d3d76e13-daf5-4ccf-a2ad-d4c66297187c`、Run
  `e0deb349-fc57-83f8-ad96-b7bd8ce82dd5`；40 events、Run SUCCEEDED、Semantic/Text2SQL 接纳。
  QueryEvidence `68f10235-93b2-8af2-8fac-1e08f971122e` 保留真实 FORMULA/非空 hash/aggregate=null。
- 业务 oracle 对四渠道全部 FAIL：例如 App 投入观察值 3825883.2000000007，而全量 source 为
  4213378.750000003；收入与 ROAS 同样不符。L2-02 原题未要求时间区间，不能为了匹配回答修改 oracle。
- 真实 SqlArtifact `858e1935-ae65-8b8b-a2ae-7d190a3607ec` 有 `date::timestamp >= $1` 与 `< $2`，
  但 accepted semantic binding 的 time_window=null。参数值未在该公开投影保留，故不倒推实际历史起止日期。
- 首个候选因时间 Dimension 不在 accepted Context 被拒绝；后续已接纳候选省略窗口却保留 WHERE。
  原 `timeWindow()` 在无声明时立即返回 null，compile 也没有反向守卫。日期 source 确定性回归在旧实现上 resolved
  而不是 rejected，直接复现合同漏洞；文本日期还覆盖显式 cast 与没有独立时间列 binding 的路径。

## 2. Why Fixes Failed

- continuation 与 Formula 输出修复已在真实 Run 证明作用：本轮成功继续到 Text2SQL，并正确绑定独立 Formula。
  这些证明不意味着业务数值正确，也不等于前一修复失效。
- 提示词已说明 coverage 不是请求过滤，但没有服务器反向约束；模型可以只删除声明通过原 guard。
- 本次证据足以区分两条链：Formula 表达式证明通过，实际 SQL 有时间条件却没有窗口声明；不将数据库/模型偶发性作为原因。
  具体参数窗口仍未知，未用猜测补齐历史；不在相同 build 或失败 scratch 上再试一轮。

## 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
| --- | --- | --- | --- |
| P0 | Runtime | compile、adapter admission、evidence acceptance 共用负向时间选择证明 | DONE |
| P0 | Lineage | snapshot/已选 Metric/Dimension 时间来源经 AST、CTE alias 逐层传递 | DONE |
| P0 | Tests | 时间条件遗漏、文本日期、Formula、CTE、全部条件位置与零 I/O | DONE |
| P1 | Diagnostics | 精确安全码进入原 bounded repair；不泄露 SQL/参数或改 adapter 公共错误合同 | DONE |
| P1 | Business | 原题全量 source oracle 在业务阶段拦截，未消耗 QA/Trace UI 门禁 | DONE |
| P1 | New proof | 新 clean build/fresh scratch canary，再正常 live E13 与全新 15 回合 | PENDING |

## 4. Systematic Expansion

- 不能只检查 WHERE 字符串：CTE 时间 alias、布尔派生、HAVING/JOIN/FILTER/CASE 都可能隐藏数据子集。
  实现使用已有 PostgreSQL parser 的作用域分析，不引入通用 SQL 生成器、业务模板或第二权威。
- 时间元数据用于拒绝不诚实声明，不授予 missing Dimension 权限。保守子集也拒绝时间非空和时间相等 JOIN；
  日期显示/分组/latest-row 排序仍允许。真实请求有窗口时必须取回治理上下文，不能删请求条件。
- 已声明窗口的正向 bounds/coverage 证明继续独立执行；本修复不声称解决任意 SQL 等价性。
- run terminal、公式身份、来源数值、答案及 Trace 是不同验收层。此次按顺序在业务失败处结束 canary，
  QA/Trace 记 null，绝不把 Run SUCCEEDED 写为 PASS。

## 5. Knowledge Capture

- [x] backend/text2sql-resolved-context.md 增加反向时间证明完整合同；artifact-authority.md 增加 acceptance 约束。
- [x] design/implement 记录新故障与恢复边界；仓库无 src/templates/markdown/spec，不创建影子模板。
- [x] Platform 11 suites/179 tests、Worker 40 suites/277 tests、两端 typecheck、11 owned TS Biome 通过。
- [ ] 新构建与业务闭包仍待执行。failed scratch/证据保留，昂贵服务/browser 已停，live E12 不变。

证据：audit `e13-roas-canary-506c3cb8/{result.json,business-failure-evidence.json,oracle-channel.json,business-failure.png}`。
首次浏览器填充定位失败发生在提交前；读取空 DOM 和数据库 message_count=0 后，仅作一次恢复提交，预提交记录与实际
Conversation/Run 一并保留。没有重复提交、补造 receipt 或越过业务失败去跑 UI gate。
