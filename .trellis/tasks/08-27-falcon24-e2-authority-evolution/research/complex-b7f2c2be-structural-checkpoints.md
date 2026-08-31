# Bug Analysis: 比较形态反馈无法区分错误

## 1. Root Cause Category

Category B/D：诊断契约过粗、覆盖未区分结构检查点。原QUERY_SHAPE涵盖解析、SELECT限制、CTE、期间JOIN/别名。
固定b7f2c2be构建8/8、full unit15/15、attestation PASS，另补旧合同/生产方法/提示32项通过。
专用NAS55490的348表克隆一致，仅scratch迁移10816；347业务表不变、9表70列121445行1902NULL通过。
一次认证PASS Run7a887ff6-4485-5aa9-a99d-a6eeb73f6b8d，baseline ed46bde7-0bc3-5be9-959f-5a5f018b5731，production HOLD。

A1 Run baf01044-8d3f-8b4a-8861-d4fde0c9562c FAILED/74events；SemanticQueryContext已含准确两种请求操作，冻结意图hash通过。
3个Text2SQL任务各2候选，三个候选hash每对相同，均COMPARISON_QUERY_SHAPE；最终ROOT_AGENT_TURN_BUDGET_EXHAUSTED。
没有SQL、QueryEvidence或Analysis产物，不能以event_count推断执行阶段。没有提交A2/B，没有做该失败Run的UI验收。

## 2. Why Fixes Failed

之前A2的比较旁路和总体事实修复有离线证据，但新A1未执行到那里，既不能据此宣布回归，也不能宣布业务已修复。
原错误不能区分多个结构假设：SELECT限制、CTE声明、JOIN/alias、解析均可能。真实SQL不在持久历史里：
当前direct Specialist返回内存output_text，只有4个Root的ProviderResponseArtifact可由既有READ授权读取，内容并非SQL候选。
因此具体原候选原因仍未知；不赋予未经证据支持的“LIMIT”或“FULL JOIN”确定性。

## 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
|---|---|---|---|
| P0 | Runtime | 精确无值SELECT/CTE/PERIOD_JOIN诊断、共享原修复白名单，解析保留旧码 | DONE |
| P0 | Tests | 6个新结构反例先RED后PASS，错误只有diagnostic_code，原接受边界不变 | DONE |
| P0 | Architecture | 从已批准请求语义提供经原证明校验的SQL骨架，避免模型猜严格语法 | IMPLEMENTED；待新Run证明 |
| P0 | Evidence | 原失败不可重放，不借助Root文本臆测Specialist SQL | DONE |

## 4. Systematic Expansion

源码证明检查点、公开错误与repair guidance必须成套测试。若多个原因都落到相同大码，不应继续相同模型重试来猜原因。
不能因缺少原候选直接放宽SQL firewall；任何编译骨架仍由原source/AST/temporal/result/Oracle逐层重验。
本轮清理精确停止73748/74239/63784，关闭一个browser/auth，取消55490转发、删除自有capability；
专用scratch容器停机、volume和audit保留，live after348表与before相等，共享SSH/普通NAS数据库保留healthy，OrbStack关闭。

## 5. Knowledge Capture

- [x] 更新backend/text2sql-resolved-context.md与本任务checkpoint。
- [x] Platform三文件207项、Worker两文件101项、Platform typecheck/Biome检查通过。
- 模板目录src/templates/markdown/spec不存在；不创建第二套无消费者模板。
- 原始audit：/Users/lienli/.codex/audit/falcon24-e1-authority-reset/complex-b7f2c2be/turn-01。
  rejected-candidates.json明确findings=[]和不可恢复限制，不能当作保存了六份SQL。
