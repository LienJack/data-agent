# Complex L4 scratch — 1ff782a6 narrative boundary

## Observed evidence

- Clean `1ff782a641c157ed49c9ad5ff0565a0950e5297c`：force build8/8、full unit15/15（14 cache）、attestation PASS。
- NAS scratch `data-agent-falcon24-e17-1ff782a6` /55485；9表/70列/121445行/1902NULL、348表clone与live一致。
  原认证Run `e4b66e3c-b831-5046-99d7-bc1fb5ec1dd4` PASS；仅scratch Finalizer ACTIVE，baseline
  `16a18823-30a1-50de-8967-395d26802dbb` / `sha256:8b7ee8b9a79b9d5c0e85bb76b8fd22250f5f0c63a06fb5a2aa68f3bb4b346e0c`。
- L4A1一次composer：Conversation `89907e6d-ef26-4128-8524-cfcf7650c409`，Run `f3a381bd-ee26-8231-8a5a-d7bac4e53f0e`
  SUCCEEDED /57 events；Semantic→Text2SQL→Analysis，1次Python直接成功、无repair，Publisher/Oracle通过。
- 独立源SQL核对12个月当前收入、发布覆盖内6个同比、覆盖外NULL均通过；不把物理但未发布的历史月份用于同期。
  QueryEvidence `39a89363-7bb1-809e-988a-424dddcff330` / `sha256:273d8d1c5c964057bd1557fc3a1a003ce8ed3fd2c7c1bbf644aba6927c45e138`。
- 业务人工/确定性复核 **FAIL**：最终解释两次声称“期初和期末值缺失”，而已验hash的RESULT中
  comparison first=null / last=578369.8299999998，yoy first=null / last=-0.0703129518356789。
  原报告和Run SUCCEEDED均未改写；新独立business-review记录`ANALYSIS_NARRATIVE_NULL_ENDPOINT_CONTRADICTION`。
- 未继续A2或QA/Trace；live348表before/after一致。Web/Worker/OpenSandbox/browser/auth关闭，scratch停机保留、55485转发取消、临时capability移除。

## Bug Analysis: final explanation loses objective and overgeneralizes missingness

### 1. Root Cause Category
- **B / E — Cross-Layer Contract / Implicit Assumption**：FINAL调用丢掉当前ResearchBrief objective，只要求解释整份多指标summary；
  因此模型逐项复述辅助序列，并把result级`RELATIVE_DELTA_UNDEFINED`泛化为两个端点都缺失。
- 冻结Oracle、RESULT/表图和summary投影均保留正确单边NULL；这是解释错误，不是算术错误或被丢弃的源值。

### 2. Why Fixes Failed
- 前轮日期/dtype修复后Python已直接成功，但Oracle校验数值不等于自由文本也正确。
- 不以降低业务准确性、删NULL、改源表、扩大重试或覆盖旧结果解决。

### 3. Prevention Mechanisms
| Priority | Mechanism | Specific Action | Status |
| --- | --- | --- | --- |
| P0 | Intent propagation | 唯一FINAL调用携带已有objective，作为意图而非事实，聚焦所问的经营结果 | DONE |
| P0 | Missingness semantics | 显式逐字段解释NULL/0，不由change或全局限制码倒推两个端点 | DONE |
| P0 | Regression | objective投影与非对称NULL/0两项先RED后GREEN，旧证据投影不变 | DONE |
| P1 | Honest acceptance | Run成功但business FAIL独立保留；无下一题/UI，不拼历史PASS | DONE |
| P1 | Fresh proof | 新clean build/scratch，再真实复杂多轮/正式15回合 | ACTIVE |

### 4. Systematic Expansion
- Report/Analysis写作都要持续传递当前意图与可接受证据，不能只传一包统计量后要求完整复述。
- 本次是提示/接线上下文修复，不声称字符串提示能确定性证明任意未来文本正确；真实业务逐题复核继续保留。

### 5. Knowledge Capture
- [x] spec与implement checkpoint同步；原Python/runtime和独立Oracle不改。
- [x] Worker相关53文件634/634、focused3文件76/76、Worker typecheck/build通过。
- [x] 输入/解释规范移到backend/analysis-agent-feedback.md并从index与任务context路由，避免根规范超32KiB截断；原契约不变。
- [x] 最终Trellis/Biome/diff通过，新叶子与根规范均低于32KiB；旧artifact/plan超限警告不在本次变更范围。

完整证据：`/Users/lienli/.codex/audit/falcon24-e1-authority-reset/complex-1ff782a6/turn-01/`，含business-review、source Oracle与安全Worker进度日志。
