# Complex L4 scratch — 3f876865 Cell feedback

## Observed evidence

- Clean `3f876865c7a85a426bc81b5d4f48e4550df651f9`：force build8/8、full unit15/15 task、attestation PASS。
- NAS dedicated scratch `data-agent-falcon24-e17-3f876865` /55484，物理备份验证、348表克隆一致、9表/70列/121445行证明通过。
- 原认证Run `10238168-0aaf-5e3c-8f86-081130a5f45a` PASS，仅scratch Finalizer ACTIVE；baseline
  `c9e57335-c8c9-578f-bc9d-58a9682997f8` / `sha256:fe06ab41a1a87c17a5e327300a55944eea809f491734c67091c0e6cea9e939d3`。
  production isolation仍HOLD；live仍E16 FAILED。
- L4A1一次composer：Conversation `6e7c4d12-9d50-4fb5-af02-43421a9917e6`，Run `d0186159-a230-8fba-8c46-0ea7dd1e394a` FAILED，72 events。
  Semantic r6与Text2SQL r5 ACCEPTED，后者一次别名修复；QueryEvidence `3dfe48dd-2e16-8f04-a702-04fab7886b87`
  / `sha256:1cd6181b4e20c1b3aefa539492f0bf23292b7b4b8c9f96157489274aa2ac7533`。
- 两次Analysis执行均planner完成、进入PUBLISH_REQUIRED后，首Cell与允许的一次repair均AttributeError，identifier=null；
  Worker诊断为`ANALYSIS_AGENT_REPAIR_BUDGET_EXHAUSTED_CELL_EXECUTION`，外层seq51/68仅见publication terminal HOLD。
  没有成功Cell，journal/stage/oracle/python_sources均0；不存在可读取的失败源码。原始错误消息未保留，具体属性错误仍未知。
- 业务失败后未继续A2或QA/Trace UI。旧1f53b91e业务成功及73节点只读修复诊断不拼入本轮PASS。
- live348表before/after完全一致；本轮Web/Worker/OpenSandbox/browser/auth已停止，checkpoint/audit保留。

## Bug Analysis: data-free library errors lose actionable feedback

### 1. Root Cause Category
- **B / E — Cross-Layer Contract / Implicit Assumption**：逻辑DATE与pandas dtype并非相同合同；现有反馈只识别
  `'Type' object has no attribute 'member'`，不识别pandas固定accessor消息，模型收到AttributeError/null与泛化修复指令。
- 使用现有NAS Agent image、禁网络/只读的一次性Python进程证明：Arrow ISO文本→DataFrame object→`.dt`抛出
  `Can only use .dt accessor with datetimelike values`；显式errors='raise'转换后结果日期与源完全相等。
  此为确定性的覆盖缺口复现，不是对上述失败Run原文或实际源码的还原。

### 2. Why Fixes Failed
- Trace共享role修复与此无关，当前业务未完成，尚不能走读端验收。
- 不能再依赖空泛“修复AttributeError”；也不能记录原始行、任意异常全文或扩大重试预算。

### 3. Prevention Mechanisms
| Priority | Mechanism | Specific Action | Status |
| --- | --- | --- | --- |
| P0 | Safe feedback | 两条固定accessor消息精确映射稳定码，未知/附数据消息不透传 | DONE |
| P0 | Input contract | 提示明确逻辑日期不等于dtype，显式转换、原日期/NULL/timezone不变 | DONE |
| P0 | Regression | 4项RED→GREEN；provider反馈、日志无raw output，一次repair仍闭合Publisher | DONE |
| P0 | Boundaries | 原预算/strict零repair、AST/Oracle/发布权威不变 | UNCHANGED |
| P1 | Acceptance | 新clean build/scratch完整多轮与正式15回合 | ACTIVE |

### 4. Systematic Expansion
- 异常安全投影应保留可操作、无数据的稳定类别；不能把任意字符串回显作为可观测性修复。
- 月度/分群/date和timestamp共享此输入提示，但不改原source类型、行/NULL或Oracle。

### 5. Knowledge Capture
- [x] backend/python-sandbox-execution.md与implement checkpoint同步；不另建发布规则或扩大业务题库。
- [x] Worker Analysis/Teams/provider诊断53文件633/633通过；Worker typecheck/build通过。
- [x] Trellis/Biome/diff验证通过；旧scratch停机保留、取消55484转发，移除本轮临时capability文件。

证据：`/Users/lienli/.codex/audit/falcon24-e1-authority-reset/complex-3f876865/turn-01/`、`complex-3f876865-after.json`。
