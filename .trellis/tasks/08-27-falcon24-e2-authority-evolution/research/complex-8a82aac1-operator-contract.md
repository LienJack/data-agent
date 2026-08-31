# Complex L4 scratch — 8a82aac1 operator contract

## Evidence

- Clean `8a82aac109a07500cbacac3359cf6c907f10aac8`：force build8/8、full unit15/15 tasks，attestation PASS。
- 新NAS物理克隆 `data-agent-falcon24-e17-8a82aac1`，loopback55482；9表/70列/121445行一致。live前后348表完全相等，仍E16 FAILED。
- Scratch认证Run `09f029e5-decc-5f18-98c5-32c4b9fd6420` PASS；仅scratch Finalizer ACTIVE。
  baseline `f4edbfe8-0580-5801-a8ab-28b0040bc0f9`，hash `sha256:237d41cfef50b2008f17217098fe5a4b0f9c2a69d83e46b6dd0023953adf534e`，production isolation仍HOLD。
- 同一道L4A1一次composer，Conversation `ea3a8a1d-db72-4083-a057-19049e8b5783`，Run `48a12b09-191d-8798-b767-00c3d0b383c6` FAILED /64events。
- Semantic/Text2SQL ACCEPTED；seq46与59均公开安全诊断 `SCHEMA_INVALID/custom/nodes/0/operator_obligations/0/$field`。
  这证明候选加入了非空operator obligation并触发其refinement，不是超时或JSON解析失败；未知字段名与值未公开。
- 接受QueryEvidence四列是DATE月份、本期收入、去年收入、请求同比率；当前固定source的production selector为
  `published-monthly-multi-measure-comparison@1`，其 `required_operator_obligations=[]`，仅描述性分析。
  方法身份/空数组是依据当前selector源码、接受输入类型和生产composition回归所得；原失败响应未保存，不声称知道模型选了哪个operator或绑定值。
- ResearchBrief没有operator_obligations字段，诊断audit中该投影null不表示缺失方法合同；Host在后续planning context明确提供该数组。
- Python尚未执行，没有继续A2或Trace UI。已停本轮Web/Worker/OpenSandbox并关闭browser/auth，旧失败与audit保留。

## Bug Analysis: exact Host obligations described as model choice

### 1. Root Cause Category
- **B / E — Cross-Layer Contract / Implicit Assumption**：原prompt写“choose operators”和“exact ids”，
  compiler实际要求完整数组与Host严格相等。空数组明确性不足，模型补出了未经方法声明的统计义务。
- 前一轮的safe diagnostic修复有效，提供了此前缺失的判别证据。不能把此轮证据倒灌成6b354a6e旧输出的已知原文。

### 2. Why Fixes Failed
- 原提示只约束ID，不明确完整nested绑定、顺序、空列表；结构化schema也不表达method-specific数组相等。
- 不增加重试/Root回合，不丢弃校验；本次只修正提示与原Host契约的对应关系。

### 3. Prevention Mechanisms
| Priority | Mechanism | Specific Action | Status |
| --- | --- | --- | --- |
| P0 | Prompt | 每选中方法完整复制数组，顺序/嵌套字段不变；空数组必须保持空 | DONE |
| P0 | Runtime | 原schema与compiler exact比较不变，不允许添加或删除方法算子 | UNCHANGED |
| P0 | Test | 新prompt RED→GREEN；新增schema合法但Host未要求的operator拒绝；保留mandatory回归 | DONE |
| P1 | Acceptance | fresh clean build/scratch真实重验，再L4和正式15回合 | ACTIVE |

### 4. Systematic Expansion
- Prompt应表达可执行契约而非泛化领域建议；描述性方法和强制统计方法都从现有registry决定，不能按关键词或模型常识加义务。
- 用户允许澄清/降低业务歧义，但本缺陷不是业务难度问题，无需改题、发布公式或新增权威。

### 5. Knowledge Capture
- [x] backend/agent-team-runtime.md与implement checkpoint更新。
- [x] Worker Analysis/Teams/dispatcher与安全诊断54文件639/639；Worker typecheck/build、3文件Biome通过，Trellis/diff检查通过。
- 模板目录不存在，不新建重复spec。离线PASS不代表实际planner或复杂四层已通过。

只读证据目录：`/Users/lienli/.codex/audit/falcon24-e1-authority-reset/complex-8a82aac1/turn-01/`。
