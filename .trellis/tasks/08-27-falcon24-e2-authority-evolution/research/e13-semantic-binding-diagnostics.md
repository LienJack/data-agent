# Bug Analysis: accepted-context binding 的错误边界不可区分

## 1. Root Cause Category

- **Category**: B — Cross-Layer Contract；D — Test Coverage Gap。
- `e88c1689` clean force build 8/8、attestation、单并发 full unit 15/15（14 cached）通过。
  live E12 物理克隆到 `data-agent-falcon24-e13-e88c1689`（55464），backup manifest 与 9 表/70 列/121445 行证明完全一致。
  正常认证 Run `09711d4e-4a26-5d0a-a661-3412c18b4af7` 后，仅 scratch 正常激活 E13。
- 一次真实 composer 创建 Conversation `e54c07d4-8cb4-5b62-83f0-370583ef5f29`、Run
  `38ad317a-1c9d-86db-8f5b-3c21f6c0086b`。原 intent 中的预选 Conversation 不存在，普通 UI 分配了实际 ID；
  intent 保留，result 同时记录两者，不把非正式 canary 当成带 fence 的正式提交。
- Semantic 正常继续到 Text2SQL；三次 child task 的六个候选均在 COMPILE 被
  `TEXT2SQL_SEMANTIC_BINDING_OUT_OF_RANGE` 拒绝，最终 74 events、`ROOT_AGENT_TURN_BUDGET_EXHAUSTED`。
  业务 FAIL，QA/Trace 未运行；服务和 browser 已停止，live 仍 E12，正式 E13 未创建。
- 原守卫合并了结果对象越界与时间维度越界，安全事件只有候选 hash/types，不能追溯出原 SQL 或确认具体分支。
  新确定性测试在旧代码上 2 failed / 44 passed，证明缺少分支诊断及其 Root 传播。

## 2. Why Fixes Failed

- `cbf9a8bd` 修复的是 Semantic continuation 的提前结束；本次已观察到正常后续 Text2SQL，不能据此说前一修复无效。
- 本次没有重跑失败 canary。三个相同 compile failure 来自同 Run 内原有 Root 决策；转入离线诊断，不再继续模型试跑。
- 初步假设：结果类型/对象不完整 45%、时间维度遗漏 45%、其他 10%。当前 guard 的真实来源只有前两分支；
  exact published catalog 与 accepted Context 进一步证明存在结构缺口，但不倒推原候选的具体绑定字段。

## 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
| --- | --- | --- | --- |
| P0 | Runtime | 两个精确诊断，保留原 failure class 与原拒绝条件 | DONE |
| P0 | Tests | 结果/时间越界、既有合法候选、白名单传播、repair 与脱敏 | DONE |
| P1 | Guidance | Formula 不冒充 Metric，time domain 不冒充 Dimension；不删除请求约束 | DONE |
| P1 | Contract follow-up | 正式 Formula 输出缺少合法候选/证据绑定，另做最小完整修复 | PENDING |

## 4. Systematic Expansion

- 实际 gen2 catalog 有 `formula.marketing_roas`，但没有 `metric.marketing_roas`；accepted Context 只有投入/收入两项
  Metric 与渠道 Dimension，另含 ROAS Formula/time domain。现有 Candidate/QueryEvidence 仅允许
  METRIC/DIMENSION/PHYSICAL_COLUMN，无法诚实表达独立 Formula 输出；必须显式绑定已发布公式及其依赖，不能伪造 Metric。
- 该 Context 没有时间 Dimension；Root objective 却建议 complete-month time domain。单独读取 time domain 不构成用户
  需要过滤时间的证明，也不授权编造 dimension。后续修复须区分请求窗口与发布覆盖范围。
- 以上结构事实来自只读 catalog/Context；历史候选未持久化，不能宣称某条 SQL 的确切内容。
- 失败 audit：`e13-roas-canary-e88c1689/result.json`、`business-failure-evidence.json` 与单张失败截图；旧 build 不再调用模型。

## 5. Knowledge Capture

- [x] 更新 `.trellis/spec/backend/text2sql-resolved-context.md`。
- [x] 仓库无 `src/templates/markdown/spec/`；不创建影子模板。
- [x] Worker 三个聚焦套件 64/64、typecheck、6 个 owned TS 文件 Biome、Trellis validate 与 diff check 通过。
- [ ] Formula 输出绑定修复、新 clean build/scratch canary 与 fresh live E13/15 回合正式验收仍未完成。
