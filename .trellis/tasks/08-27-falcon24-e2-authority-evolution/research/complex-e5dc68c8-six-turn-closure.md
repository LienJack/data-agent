# `e5dc68c8` 六题复杂四层预检闭合

## 结论

`complex-l4-semantic-defined@4.4.0` 的 A1/A2/A3/B1/B2/B3 已在同一个 clean build、同一个 fresh E17 physical scratch 和两个连续
Conversation 中全部通过。每题均先完成独立 source/stage/business Oracle，再复用同一个 Run 验证 Q&A、答案入口 exact Trace、全部节点和
Artifact 详情、刷新恢复。该结论只关闭 F5/F7 前的复杂能力预检，所有 receipt 都明确为 `formal_gate_pass=false`，不构成 §20 正式15回合 PASS。

## 冻结边界

- source commit：`e5dc68c8a9d6324a78fe6a219a14b4228c273d34`，Git dirty=false。
- generation：`sha256:09e41b6c1a67346d7175c9dc658feaad06090010be10285e03d92e80be39b446`。
- Web build：`sha256:98b985504ad84f310ce8b0b967316ecd25afcf379fc53c8271b536bfc6cafe9f`。
- Worker build：`sha256:74fc00dd94cfac692791680578522d74a86d453bc9dbded55e56c3d41a9e96ad`。
- clean force build：8/8；workspace 单并发 full unit gate：15/15；Web 645 PASS/1 SKIP，Worker 101/101。
- scratch：NAS physical cluster `falcon24-e17-e5dc68c8`，container `data-agent-falcon24-e17-e5dc68c8`，local port 55529。
- dataset：9 tables、70 columns、121445 rows、1902 nulls；LLM certification Run
  `3a465f5f-2900-50e4-8743-f282770600ca` PASS。
- scratch E17 baseline `4a5bceef-4bf2-508e-a1f6-3bf32c14b99c`，activation attempt
  `abb10661-2837-54c7-b3a0-b1edc063bfe0`；live authority始终为E16，本轮未写live。

## 六题结果

| Case | Run | Conversation | 关键业务闭包 | Trace |
|---|---|---|---|---:|
| A1 | `8a0a153a-34ad-8fd8-95aa-bbd4d84e919e` | `0b4cf629-1891-423c-ad40-6eeb4d77264f` | 12月同比、Semantic→Text2SQL→Analysis、两图 | 73/73 |
| A2 | `9ebdec0e-a934-8977-b3e3-34c4b5924745` | 同上 | 48行月×客户类型面板、一个Analysis Stage、两类必需图 | 76/76 |
| A3 | `7e194e22-595a-8171-9019-63c2d49f950b` | 同上 | 当前Run复验、总体趋势和三个月拆解合并、两图 | 80/80 |
| B1 | `7d7c6ab4-c999-8be3-88c2-d34052ba7232` | `a5e1535b-e87e-4921-bb51-ea5b35aeb4c4` | 已发布ROAS实际AST、四渠道精确Oracle、单Stage | 73/73 |
| B2 | `bf920b92-c9b0-8dcd-892e-bf8627147643` | 同上 | REQUEST_ONLY/NONE净ROI、四渠道重算、不复用ROAS列 | 73/73 |
| B3 | `ea240149-cb75-8f66-bb60-bd449d5da022` | 同上 | 双月32行六列、单Stage、SMS主筛选、四类人群 | 98/98 |

六个 result 均为 PASS、一次 composer submission、live authority writes=0、refresh return PASS。节点全部打开；Artifact 详情打开数量依次为
5/4/4/5/5/4。A、B 两组各自保持固定 Conversation，三轮使用不同 Run，没有把历史 assistant 文本当事实证据。

## B3 决定性证明

1. frozen selection 同时包含 `blinkit_marketing_performance date` 物理列与唯一 runtime time Dimension。
2. SemanticQueryContext 同时包含 `RECENT_COMPLETE_PERIODS` 与请求级 `AGGREGATE_RATIO`，后者为 `REQUEST_ONLY/NONE`。
3. QueryEvidence 恰为32行，绑定 `month/channel/target_audience/spend/revenue/net_roi` 六列；`net_roi` 绑定当前 Context hash。
4. 独立 source Oracle 逐行重算通过；同一 Run 只有一个受治理 Analysis Stage，stage result 与独立 ratio-rollup Oracle 零差异。
5. 渠道主筛选唯一为 `SMS`；`All`、`Inactive`、`New Users`、`Premium` 四类目标人群全部保留。
6. 图表覆盖完整32行面板；叙述中的可能原因和下一步均明确标为待验证假设，没有因果或持续趋势断言。

## 下一唯一动作

本文件提交后 HEAD 会变化，不能把当前 scratch 直接升级为正式门禁。先审计并关闭 `e5dc68c8` 运行现场、核对 live E16 348张表零漂移，
再用新 HEAD 重新 clean force build、fresh physical scratch、版本化 four-layer manifest 和唯一 formal attempt，从 L1-01 开始执行 5/2/2/6
共15回合。正式 business PASS 后才做同 Run UI/Trace；不能复用本文六个 Run、Conversation、Artifact 或 receipt。
