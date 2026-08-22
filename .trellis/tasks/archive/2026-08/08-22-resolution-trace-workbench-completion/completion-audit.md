# AC1-AC18 完成证据账本

状态定义：`PASS` 同时具备当前代码和与风险匹配的测试/浏览器证据；明确 unavailable 也是内容边界，不以当前 Catalog 猜测历史事实。

| AC | 状态 | 权威证据 |
| --- | --- | --- |
| AC1 | PASS | `ResolutionTracePanel` 四泳道与 80-node 1440/390 browser fixture；无 document overflow。 |
| AC2 | PASS | browser fixture 覆盖 11 个公开状态，颜色之外还有形状、文本与 `aria-label`；`resolution-trace-workbench-model.spec.ts` 覆盖十类节点。 |
| AC3 | PASS | 真实耗时/sequence 切换、缺失耗时显示“耗时不可用”；80-node fixture 同时覆盖 null 与数值 duration。 |
| AC4 | PASS | 单一 `selectedNodeId` 驱动 timeline/list/Inspector；浏览器 ArrowRight 从 sequence 1 精确移动到 sequence 2。 |
| AC5 | PASS | browser 真实 pointer drag 将 80 行裁到 35 行，WheelEvent 缩放到 64 行，double-click 恢复 80 行；平移/重置控件保留。 |
| AC6 | PASS | 搜索 `SQL_TIMEOUT` 只保留 1 行与 1 个时间轴命中；10k 搜索 `阶段 10000` 精确定位 tail node。 |
| AC7 | PASS | `ResolutionTrace` contract 拒绝悬空/重复/乱序 edge；列表显示 parent/child hierarchy，阶段/调用 disclosure 保持原生按钮语义。 |
| AC8 | PASS | `resolution-trace.spec.ts` 十类 detail strict fixture；Inspector Summary/Payload/Result/Schema/Timing 浏览器切换通过。 |
| AC9 | PASS | `field-inventory.md` 覆盖 Run/Conversation/Config/Event/Tool/Agent/Artifact/SQL/Task/Handoff/Epoch/Verifier/Acceptance/Schema/Context；v2 内容投影与显式 unavailable 已落地。 |
| AC10 | PASS | Platform Config 回归证明只消费 frozen receipt；无公共历史内容时返回 `HISTORICAL_CONFIG_CONTENT_UNAVAILABLE` + `HISTORICAL_DISPLAY_NAME_UNAVAILABLE`，不查询当前 Catalog。 |
| AC11 | PASS | Trace/Tool/SQL/Artifact 复用 exact `ArtifactPreviewPanel`；`resolution-trace-view.spec.tsx` 验证内容入口不以裸 ID 收口。 |
| AC12 | PASS | `artifact-workspace-component.spec.tsx` 覆盖既有 Markdown/Table/Report/SQL/Chart safe renderer、分页与非成功态。 |
| AC13 | PASS | Artifact exact scope/run/revision/hash、denied/unsupported/hash drift 保持无 raw fallback；相关 Web 与 admin route tests 通过。 |
| AC14 | PASS | `qa-event-assembler.spec.ts` 覆盖 baseline/replay/dedupe/terminal；`resolveResolutionTraceRefresh` 回归证明同 Run 历史选择不被 append 抢走，tail 才跟随。 |
| AC15 | PASS | browser 10,000-node fixture：完整模型 10,000，record DOM=80，timeline DOM=1,200，零 overflow；回归测试保证 >300 problem nodes 时 selected/match 仍保留。 |
| AC16 | PASS | owner detail route 与 audited admin `RUN_REPLAY`/`ARTIFACT_PREVIEW` 分权；Platform/Web admin tests 验证 exact identity、immutable receipt、Viewer/普通路径拒绝。 |
| AC17 | PASS | loading/empty/error/reconnecting/authority status/unavailable/time-missing 均有稳定非成功文案；浏览器 11 状态矩阵和 reconnect Web test 通过。 |
| AC18 | PASS | 行为参考截图与公开合同，当前改动为 Data Agent 原创 projection/model/UI；未复制 Harness 源文件，无新增第三方来源文件。 |

完整命令、DOM 数量和截图路径见 `browser-evidence.md`；字段来源与禁止内容见 `field-inventory.md`。
