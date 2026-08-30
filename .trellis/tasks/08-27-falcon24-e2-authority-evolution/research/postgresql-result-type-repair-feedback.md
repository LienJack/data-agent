# Bug Analysis: PostgreSQL 结果类型拒绝缺少可行动反馈

## 1. Root Cause Category

- **Category**: B — Cross-Layer Contract；D — Test Coverage Gap；E — Implicit Assumption。
- E15 L1-04 FAILED/87 events，8 次 EXECUTE `QUERY_EVIDENCE_RESULT_BINDING_MISMATCH`，候选均声明 NUMBER/DATE/NUMBER。
  第一道 Worker 列名/顺序检查已通过，Platform 类型检查失败。历史 SQL/OID 未持久化，不声称恢复具体写法。
- 首要候选原因是文本或 timestamp 输出与 DATE 声明不符，也保留其他类型不符可能性。真实 scratch 零行探针分别返回
  `[20,25,701]`、`[20,1082,701]`、`[20,1114,701]`，证实 SELECT/ORDER BY 类型独立，但不证明历史实际选中了哪条 SQL。
- 高置信度确定的缺陷：Platform 抛出泛化码，Worker repair 只传码/原候选；重复拒绝没有实际类型供纠正。
  证据：audit `formal-e15-e4612435-092a7136/runtime/{failed-run-source,result-type-reproduction}.json`。
  探针标记 synthetic/not-historical、provider_calls=0、returned_rows=0；只连接专用 scratch 55468。

## 2. Why Fixes Failed

1. e4612435 修复跨表时间 source，确实使本题进入执行阶段；它不负责 SELECT 结果类型，不能因此回退。
2. scratch 最近订单 PASS 只证明那条生成候选。正式候选不同，不能跨 Run 借用其成功。
3. 原 prompt 讲 date_trunc 和时间谓词 cast，未明确排序 cast 不改变 SELECT 类型；重复错误码无法区分 text 与 timestamp。
4. E15 失败后不继续后题、不增加尝试、不降低 oracle；封存并停止昂贵服务后再做离线诊断。

## 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
| --- | --- | --- | --- |
| P0 | Runtime | 同名同序受支持 OID 的类型不符附带只读逻辑枚举；原严格拒绝保留 | DONE |
| P0 | Boundary | Worker 从 unknown 按原枚举/exact length/code 白名单校验，只转发无值类型数组 | DONE |
| P0 | Budget | 复用原 repair/context/attempt budget；compile 后清空旧反馈；权限错误不扩大重试 | DONE |
| P1 | Prompt | SELECT 与 ORDER BY cast 分开说明，保留发布 Dimension 类型约束 | DONE |
| P1 | Test | 实际类型反馈、未知 OID、别名漂移、脱敏、修复接收、旧反馈清除与原路径回归 | DONE |
| P1 | Business | 新构建的 fresh scratch 与 E16 全新15回合 | PENDING |

## 4. Systematic Expansion

- 诊断必须区分声明与观察；仅转发已有可信类型不会泄露 SQL/值，也不取代 authority 或 acceptance。
- 对同类修复先提供有界、白名单反馈，不自动改 SQL/时间窗口/绑定，不靠加模型轮次掩盖契约问题。
- 生成 SQL 具有变化；单条 canary 通过不能预先签发 formal PASS。历史失败活动与前缀不可变保留。
- 这里不增加新持久化候选系统；修复范围限于现有错误、repair context、诊断与 prompt。

## 5. Knowledge Capture

- [x] 更新 backend/text2sql-resolved-context.md 的七部分类型反馈契约。
- [x] 更新当前 design/implement，保留 E15 FAIL、E16 前置条件。
- [x] 仓库无对应 src/templates/markdown/spec，不创建影子模板。
- Platform 新增三个 observed type 断言在旧实现 RED，修复后 GREEN；其余验证结果见 implement。
  离线修复不是四层完成；task 保持 in_progress。
