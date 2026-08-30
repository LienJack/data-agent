# Bug Analysis: E17 scratch ROAS 与显式候选修复轮

## 1. Root Cause Category

- B / C / D：修复内容已传递，但被包在长 system 上下文中，最新 user 与初次生成相同；缺少实际 dispatcher 消息回归。
- ROAS Run `10649939-0cc3-8c64-8ed7-f0e38ccb30b8` 六次拒绝（alias 3、Formula 3），两对 repair hash 相同。
  只接受 SQC，无 SQL/QueryEvidence；历史候选 SQL 未保存，不能判断具体哪处 AST 不符，亦不能从 hash 推断缓存。
- 实际发布 Formula 是 CASE 分母0返回0；NULLIF 分母0返回NULL 不等价。明确原语义，不改发布权威或证明规则。

## 2. Why Fixes Failed

1. a029cb71 的细分诊断帮助月度同比在同 Run 内恢复成功，但不能证明所有其他候选也可恢复。
2. 原测试覆盖提示片段与 envelope 生成，未穿过真实 dispatcher 检查第二次请求消息结构。
3. 本改动捕获真实 Worker 分发至离线 model port 的请求；不调用网络，不用 mock 证明 provider/业务成功。
4. 新测试曾发现消息分支括号优先级、fixture credential env 与 canonical JSON 键序问题，均在离线检查修正。

## 3. Prevention Mechanisms

| 优先级 | 机制 | 状态 |
| --- | --- | --- |
| P0 | 原 system/user 不变，修复追加 assistant Candidate + Host feedback user | DONE |
| P0 | Contracts strict envelope 在生产/消费两端复用，拒绝额外字段和类型数量不符 | DONE |
| P0 | 保留 Formula 原 AST/零值含义；不提高预算、不重写 SQL、不扩大权限 | DONE |
| P1 | dispatcher capture 核对完整消息、task hash、call id、工具/预算与无 Root dispatch | DONE |
| P1 | business 失败即封存，不跑昂贵 UI，服务关闭；fresh build 使用新物理 scratch | DONE |

## 4. Systematic Expansion

- 后续修改 repair 必须同时核查 producer、dispatcher 和 model-port message projection，而非仅检查字符串 helper。
- 指令改进是有待真实 canary 验证的机制变化，不把相关性写成已证实的模型根因。
- L4 净 ROI 已有请求解释、尚缺 AGGREGATE_RATIO 结果证明：属于独立已知 backlog，正式激活前先补齐，不借 ROAS 身份。

## 5. Knowledge Capture

- [x] 更新 backend/text2sql-resolved-context、design §25.16、implement 当前现场。
- [x] Worker 100/100、Contracts 14/14 离线 focused 通过；历史失败/scratch/audit 保留。
- [ ] 两项修复的 clean build/fresh scratch 验证，再进行全新正式15回合。

无 spec 模板目录需同步；未使用 CE 或子代理。live 仍 E16 FAILED，E17 未激活，任务 ACTIVE。
