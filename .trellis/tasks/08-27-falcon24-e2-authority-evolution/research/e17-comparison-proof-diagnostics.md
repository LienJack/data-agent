# Bug Analysis: E17 scratch 同比证明反馈

## 1. Root Cause Category

- **B / C / D**：证明子集更新后，Provider 仍残留允许 CTE 预平移的建议；测试只验证新增指导存在，没有排除旧的相反建议。
- 现场 Run `7144b8e6-c4e7-86bc-8d92-89b57a91a1f7`：74 events、六次 compile 拒绝、三个 task 各两次相同 hash。
  前四次 RELATION_ALIAS_REQUIRED，后两次 REQUEST_DERIVATION_EXPRESSION_MISMATCH，唯一 accepted SQC，零 QueryEvidence。
- 历史 SQL 不持久化，不能判断最终错的是分组、偏移、窗口还是其他条件。代码与测试证明指令矛盾和粗粒度反馈，
  并不证明这就是每个历史候选的唯一原因。拒绝条件不因推测而放宽。

## 2. Why Fixes Failed

1. f9e64ac7 建立了正确身份和限定证明，合成 SQL 的真实参数化/查询/source oracle PASS，但不等价于模型真实生成 PASS。
2. 只追加支持子集说明漏掉旧段落的相反建议。现在必须同时断言正确指导存在、错误等价建议不存在。
3. 统一总错误码无法区分证明步骤；新增固定检查点码，下一次真实失败也能定位到有限检查，不收集原始 provider dump。
4. 相同 hash 不足以证明缓存。当前代码对 repair 使用不同 logical_call_id、完整 rejected_candidate/diagnostic context，
  dispatcher 与 Mastra projection 均传递 context。该路径审查降低“上下文必然丢失”的判断，未伪称历史网络 payload 已保存。

## 3. Prevention Mechanisms

| 优先级 | 机制 | 状态 |
| --- | --- | --- |
| P0 | JOIN-only 指令与证明子集一致，删除相反建议，原证明条件不变 | DONE |
| P0 | 一个固定 registry 约束 proof type、Worker allowlist、Provider hints；未知码不公开 | DONE |
| P0 | 错误只含固定码，总 TypeError 消息保留；无 SQL/AST/参数/标识符/cause | DONE |
| P1 | 每次调用独立 checkpoint，并发不同失败无串线；已有正向/负例继续通过 | DONE |
| P1 | 真实 canary 失败不重提；业务未过不进入 UI 验收，保留非计分失败证据 | DONE |

## 4. Systematic Expansion

- 任何 bounded SQL proof 收窄或新增后都必须核查旧提示与消费侧，不允许只添加正向片段测试。
- 细分诊断只描述确定失败检查，不输出生成 SQL，不成为授权，不增加重试预算，不重写候选。
- 其他请求派生算子仍按实际支持边界失败关闭，未用本修复宣称15问已完成。

## 5. Knowledge Capture

- [x] 更新 backend/text2sql-resolved-context 与 design §25.15。
- [x] scratch FAILED/source 保留，临时昂贵服务关闭；live 仍 E16 FAILED，未激活 E17。
- [x] 新诊断/提示断言先 RED 后 GREEN；检查点、并发、safe allowlist、repair/public events 测试。
- [ ] clean build 后全新 scratch 同比+三题回归，之后正式15问；不能沿用失败 scratch 或旧 formal PASS。

无 spec 模板目录需要同步；未使用 CE 或子代理。
