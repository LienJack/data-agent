# Bug Analysis: L4 净 ROI 请求解释与结果契约缺口

## 1. Root Cause Category

- C / D：AGGREGATE_RATIO 可生成请求解释，但新增同比执行证明时没有覆盖第二种已存在的结果算子；两个 Worker allowlist 也只筛同比。
- 正向净 ROI 被 resolver 拒绝，改标 METRIC/FORMULA 则返回空数组；离线反例确认该缺口，未等正式 L4 消耗一次 epoch 才发现。

## 2. Why Prior Coverage Was Insufficient

1. 月度同比的先前工作明确只声明其限定子集，不能把 REQUEST_DERIVED enum 已存在误认为所有算子都可执行。
2. Published ROAS 不等于净 ROI，尤其发布 Formula 的零值0不能替代当前 request operator 的 NULL。
3. 只有数学表达式相同不足：还必须证明原始 SUM、来源/粒度、分组权限/投影、无隐藏过滤、真实 OID 与空集 NULL。
4. 单元 fixture 也必须满足真实 Context closure；补齐 TimeDomain/Formula 和合法类型后，正向/重标反例才成为有效 RED 证据。

## 3. Prevention Mechanisms

| 优先级 | 机制 | 状态 |
| --- | --- | --- |
| P0 | Provider/compiler/resolver 对 exact AGGREGATE_RATIO interpretation 一致 | DONE |
| P0 | 两个算子共享 Context/原 SUM 来源/hash builder，无新 publisher | DONE |
| P0 | AST 证明源、原值、SUM-before-ratio、零值与每个分组；旧对象标签不能逃逸 | DONE |
| P0 | Context 有窗口时不退化全量；空集 SUM nullable；类型提升不截断 | DONE |
| P1 | 细分无值诊断经固定 registry 与原两候选 repair 传递 | DONE |

## 4. Systematic Expansion

- 对全部 request operator 检查解释、projection、编译、I/O admission、结果 binding、Analysis role 六个消费点。
- 已有月度同比与 Published Formula 证明继续回归；ratio 仅声明直接分类分组的全量查询，不把未实现的带窗/跨表形态列为 PASS。
- 多轮纠正仍要求新 Run 中的 exact 当前解释；旧 ROAS 文本/结果不能冒充净 ROI，本次不改变 Conversation/Artifact 引用权限。

## 5. Knowledge Capture

- [x] 更新 backend/text2sql-resolved-context 与 design §25.17、implement 现场。
- [x] Platform 225/225、Worker 101/101 focused；原始类型/空值/分组/数学/权限/上下文/旧结果回读边界覆盖。
- [x] Contracts12/12、Analysis消费25/25；两包typecheck、Biome/diff、Trellis validate通过，原有两份大文件警告不冒称消除。
- [x] NAS scratch 只读探针4渠道数值匹配，OID25/701/701/701。解释只在内存构造，无 accepted Artifact/新 Run/模型/权威写入。
- [ ] scoped commit 后 clean build/full gate，fresh scratch 五题业务通过再 UI/Trace，随后全新正式15回合及最终审计。

live E16 FAILED 不变，任务 ACTIVE；历史/audit/scratch 保留。无模板目录同步项、无 CE/子代理。
