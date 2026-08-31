# Bug Analysis: 月度投影总拒绝码缺乏可区分证据

## 1. Root Cause Category

- B / D：纯证明的 CURRENT/PRIOR_PROJECTION 同时承载目标数量、表达式包装、month unit、时间列/cast和SUM来源。
- 当前Run四次停在该总码；候选仅有hash，无法证明究竟哪个谓词失败。SQL错误、合法写法不在支持子集、或证明器缺陷仍需区分。
- 可以确认的是诊断本身信息不足；本次不把未保存的候选重建为事实，不放宽证明来碰运气。

## 2. Why Prior Fixes Were Insufficient

1. 关系metadata修复已由原Context离线重放证明；新Run已到投影阶段，但其Context不显式请求关系，不是该分支的在线回归。
2. a029的旧同比成功只证明那一份候选，不能证明所有模型生成都符合限定SQL形态。
3. 显式repair消息已经改变部分候选hash，但一个总投影码仍无法指向应该修改的输入。

## 3. Prevention Mechanisms

| 优先级 | 机制 | 状态 |
| --- | --- | --- |
| P0 | CURRENT/PRIOR各自MONTH_UNIT、TIME_INPUT、SUM_INPUT固定检查点 | DONE |
| P0 | SQL谓词、源权限、hash材料、重试预算不变；禁止原值/AST/SQL进入公开错误 | DONE |
| P0 | 每个表达式重置checkpoint，合法month后的SUM wrapper不沿用旧诊断 | DONE |
| P1 | 编译/deparse负例、原月literal正例、公开repair与真实model-port离线capture | DONE |

## 4. Systematic Expansion

- 用能区分假设的无值检查点替代对候选hash的猜测；错误仍只经有限registry传递。
- 历史总码可继续读取，新源码/Worker行为由build identity冻结；不改历史Run/receipt。
- 这不是Root规划、SQL生成或复杂跨表派生的修复；未宣称这些能力通过。

## 5. Knowledge Capture

- [x] 规范与design§25.19、implement现场同步；无模板目录，不创建第二份spec。
- [x] 六个新检查点用例先RED后GREEN；Platform241/241、Worker131/131，零真实provider调用。
- [x] 两包typecheck、Platform build、5个owned TypeScript文件Biome、diff与Trellis validate通过；原两份大文件警告保留。
- [ ] scoped commit后clean full build/unit、fresh scratch业务检查，PASS后同Run QA/Trace；随后正式15回合及最终审计。

任务ACTIVE，live E16 FAILED/E17未激活，失败scratch与audit保留。
