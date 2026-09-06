# Falcon24 四层验收与 E17 发布报告

## 结论与证明边界

2026-09-05，`3d5015b7d28dc37857203f7eab3ad2fd92c9bf53` 同一冻结构建、manifest v10、同一个 scratch
attempt 的全部 15 回合 business / Q&A / exact Trace 通过，原 Finalize 为 PASSED/version77。
随后使用不同的 fresh live staging/认证，经原 Finalizer 激活专用物理 authority 的 E17，并通过原生产代码读端口验证。
这是 §20 + §22 的完整四层结果，不是历史 core4 或旧 attempt 分数拼接。

Scratch 15 题与 live 发布是两个不同 baseline：前者证明业务及 UI，后者证明相同 build/release/profile 的前向发布。
没有把 scratch Run 复制到 live，也没有把认证当成再跑了 live 15 题。
生产隔离认证不在本次闭环范围：`production_isolation_proven=false / production_gate=HOLD`，不宣称生产 GO。

完整题面、Conversation/Run、实际调用序列、answer/Artifact hashes、各回执与 token 明细见
[仓内证据索引](four-layer-final-evidence-3d5015b7.json)。
原始矩阵 SHA-256：`71e233bd41a69852452c019114b638d4f6af7f45dd749f61b8f9c940b93b2e7b`。

## 同批 15 回合

B/Q/T 分别为独立业务复核、原 Q&A 页面、从答案进入的 exact Trace。
Token 两列仅为 Provider 实际报告的子集；未知调用不计为 0，也不是完整账单。

| 回合 | 原 Run | 实际 Specialist 顺序 | B/Q/T | 已报告 input / output；未知调用数 |
| --- | --- | --- | --- | --- |
| L1-01 | `f583fc96-7f53-886d-8f67-f8c8769f8929` | Semantic | PASS / PASS / PASS | 10830 / 241；未知 1 |
| L1-02 | `c56b8cf1-5f5a-8813-bdd5-c8f1822f720a` | Semantic | PASS / PASS / PASS | 27563 / 101；未知 1 |
| L1-03 | `b8c7e050-512f-890a-897f-c5e3b78ad2c6` | Semantic | PASS / PASS / PASS | 35252 / 116；未知 1 |
| L1-04 | `057ce4f1-8f13-8699-bb91-27c54c54abb5` | Text2SQL | PASS / PASS / PASS | 11107 / 263；未知 1 |
| L1-05 | `7e6cd4e9-cdfc-8465-bab8-65c986bb9917` | Report | PASS / PASS / PASS | 848 / 276；未知 1 |
| L2-01 | `90d6b280-c8b9-8f13-ac83-dbcd6a488003` | Semantic → Text2SQL | PASS / PASS / PASS | 35274 / 1134；未知 2 |
| L2-02 | `30d85344-c4f4-8782-9a10-d765f2bc1b02` | Semantic → Text2SQL | PASS / PASS / PASS | 57911 / 984；未知 2 |
| L3-01 | `e4f562e1-6159-851d-bade-c9400e4b6d47` | Semantic → Text2SQL → Analysis | PASS / PASS / PASS | 66746 / 3213；未知 3 |
| L3-02 | `0b011def-8718-86f8-92e5-7c0881169a73` | Semantic → Text2SQL → Analysis | PASS / PASS / PASS | 88497 / 2063；未知 3 |
| L4-A-01 | `11a51750-87d8-8549-b9ed-79aca2355b13` | Semantic → Text2SQL → Analysis | PASS / PASS / PASS | 56002 / 3187；未知 3 |
| L4-A-02 | `af3fd4b0-3b0d-840e-8935-9835a8f6d154` | Semantic → Text2SQL → Analysis | PASS / PASS / PASS | 90663 / 5059；未知 3 |
| L4-A-03 | `99615ce6-660a-875c-a62c-2312a56e82a3` | Semantic → Text2SQL → Analysis | PASS / PASS / PASS | 91691 / 5060；未知 3 |
| L4-B-01 | `0562c057-a7d2-860c-80b7-4be9f59eba43` | Semantic → Text2SQL → Analysis | PASS / PASS / PASS | 92129 / 1903；未知 3 |
| L4-B-02 | `1ce98a56-0a41-8523-85f5-ecff23c129cc` | Semantic → Text2SQL → Text2SQL → Analysis | PASS / PASS / PASS | 93757 / 2963；未知 4 |
| L4-B-03 | `33a84a44-63b1-88cb-9889-8369afd297d7` | Semantic → Text2SQL → Text2SQL → Analysis | PASS / PASS / PASS | 129625 / 7026；未知 4 |

所有正式用户消息各提交一次。100 次内部模型请求包含 Root 与 Specialist/tool loop，不是 100 次用户重提。
其中 65 次报告了 usage：input 887895、output 33589；35 次 usage unavailable。
live 认证另记，不混入业务 token 统计；本报告不推算未知 token 或金额。

L3/L4 实际为 Semantic → Text2SQL → Analysis，Analysis 生产受治理表格、图表和解释/摘要；
不虚称这些回合额外调用了独立 Report Profile。L1-05 独立 Report Agent 已通过。
B2/B3 的第一次 Text2SQL task 在编译/绑定检查中拒绝，Root 在同一 Run 内基于真实 ToolResult 再委派 Text2SQL，
最终各仅一份 accepted QueryEvidence/Analysis Stage；原拒绝事件保留，不是操作员重提、Run 重放或跨 attempt 恢复。

## 关键业务复核

- L1-01/02/03：已发布语义与请求级同比解释、已发布客单价的分子/分母/零分母分支、关系与 Join；各只出现 Semantic Profile。
- L1-04：最近十笔订单；原 Text2SQL 路径，受限查询与源 Oracle 一致。
- L1-05：三行输入九个数值逐项相符；最终摘要明确披露缺失单位/币种/倍率，不补“元”或表外结论。
- L2-01：2023-11 至 2024-10 十二完整月；前六个月按已发布数据覆盖产生 prior NULL，不读取发布范围外的原始旧日期。
- L2-02/B1：四渠道按发布 ROAS AST 聚合后计算，零投入分支为 0，不平均源 ROAS。
- L3-01：十二月当前值12/0缺失、同期与同比各6/6；统计、表和图同源，描述性趋势不升级因果。
- L3-02：十六个渠道×人群结果，单一已发布转化度量及其 Formula 支撑 Metric 正确传入 Brief；单 Stage、完整表图同源。
- A2/A3：每轮重新查询48行月×客户类型面板；独立复算12月整体同比，以整体同比排出2024-08/09/10；
  十二项分组贡献使用整体去年同期分母。A3 保留原十二月趋势数据与模板，另有客户类型对比图和经营摘要。
- B2：当前显式净 ROI 纠正覆盖 ROAS；`REQUEST_ONLY/NONE`、聚合后 `(收入-投入)/NULLIF(投入,0)`，四渠道逐项一致。
- B3：2024-09 与10两完整月，32行六列完整面板；独立复算48组统计、16组反向变化，以及渠道/人群两个父级轴的聚合。
  选中 SMS 后保留其全部四个人群（含 ROI 上升的 Inactive），没有按子组再次过滤。
  SMS 总投入183759.08→232401.78、营销收入412267.23→406028.85、净 ROI124.35%→74.71%；
  原回答披露两月比较、币种未知和非因果限制，可能原因标为待验证假设。

上述为确定性源数据/分析 Oracle 加实际答案语义审阅，不使用额外模型评委或给 Agent 注入 gold SQL/答案。

## 多轮与浏览器

- A Conversation：`cc40b8a8-0903-5b0c-94e0-9768f5efa632`；B：`48eb120b-d1fa-544e-9bda-9d4566b30373`。
  组内各三条独立 Run，同一页面/Conversation，历史只提供指代线索，当前事实重新取证。
- v10 区分资源快照版本与消息轮次；未更换资源时 resource version=1 合法，不能再要求每条消息强制递增。
- 每题通过业务复核后才做原 Run Q&A/Trace，答案入口点击、Agent/Tool/Artifact 预览、返回与刷新全部通过；
  各 Run 仅一次 run.accepted/completed，无重复模型请求 identity 或重复 side-effect receipt identity。
- 全程复用一个 `falcon24-f4aad696-8118-40a5-86e1-36bbc80765e9` Chrome 会话；独立题在会话内换页并关闭前页，组内不换页。
- 原 A3/B3 390px smoke 通过，`submitted=false`、无横向溢出/错误 banner；不扩张为完整移动端适配。

## 发布、历史及隔离

| 绑定 | 证明 |
| --- | --- |
| frozen generation | `sha256:6f562e4e2f0c74734b5f4392a518579f5391baeac91b0569573bb1a3d9d42337` |
| Web build | `sha256:d3cd9b8852cf1ca2bee3e26855a3a892acacc7334ff916e5afc67f91e7de0368` |
| Worker build | `sha256:fa70678fe76ea3d662b307a7ad212423387f39f5f5ca452e0236d17f929cf128` |
| scratch attempt / baseline | `f4aad696-8118-40a5-86e1-36bbc80765e9` / `83c87151-0b89-58c0-b870-18988a28cf6a` |
| live baseline / activation | `3c995b1c-d25f-5694-99f5-56903dfdc8ac` / `09263549-b514-5391-97c7-aa6b07a1e0cf` |
| live baseline hash | `sha256:d0058eb9d8ca14cf85d34ee654d0c749b92c60767143df5099cc69e38cfa1e20` |
| live staging / certification stage | `4df14ec1-b7ce-4f90-bf53-79699893ba0b` / `626a0788-6125-448f-9046-fbac8256bc6f` |
| certification Run | `96eb3fce-d96a-50ab-a2f9-7d7c2c8e17dd`，原 CLI 一次 PASS、replayed=false，先 STAGED/inactive 再 PROMOTED |
| physical source / endpoint | system `7678467078472929314`，原专用卷 `data-agent-falcon24-e1-e81a29c6-pgdata`；NAS loopback55433 经显式 SSH 绑定 |
| dataset / published authority | 同一 gen2、相同 schema/defaults/profile set；9表70列121445行1902 NULL，content/inventory hash精确一致 |

原 source 容器是只读、无端口的包装。先完成348表零漂移审计和 `pg_verifybackup`，保留 E16 never-started backup；
停止旧容器后才由唯一 live 容器挂载原物理卷。未创建第二份 live 数据库，未使用普通 NAS `data_agent`。
10816–10825 原注册迁移逐项应用；347业务表及旧226条 ledger 完全不变。没有手工改权威表或绕过语义审批。

发布后328张表完全不变，18张表只新增正常认证/发布/迁移记录；原历史行无删除或改写。
唯一两个合法 mutable-head 更新：当前 E16→E17 指针，以及 Report Profile 当前 revision→5。
E1–E16 baselines/attempts/失败回执、gen1/gen2、旧 Run/Artifact 保持原字节。
rejected repair stash `164b4bf2bf3ba83e5286f4145ae2f27debc53135` 的五文件 binary diff 与第六文件 blob 均匹配，
未 restore、执行或 drop。

## 持续执行与失败边界

AC-AUTO-01 的证据包括原 FAILED attempts、其后的 scoped fix/新构建，以及本批15题中刷新/重复 identity 的只读检查；
失败的 Run 未重新提交，历史 PASS 未拼接。原全量单测覆盖 Run lease/checkpoint、authority recovery、version/CAS 和重放拒绝。

AC-AUTO-02 是本 Codex 任务的执行合同，不是新增生产后台调度服务。
历史402保留 immutable failure；官方余额探针在09-01 04:11:19Z、04:16:41Z、04:34:03Z均返回 unavailable，
05:06:53Z恢复 available，各次 model_calls/runs_created/authority_writes=0。
等待时关闭昂贵服务、保留 checkpoint；恢复后从 fresh build/scratch 继续，不重放旧402。
本轮 fresh 认证实际通过，验收与激活时没有未满足的外部条件或待审批 Candidate。
清理完成后的 NAS 连通性变化见下节；不能把历史通过推断为此刻服务在线。

## 资源与恢复

- Analysis 资源观察1159样本，真实总数 `0→4→0`（2角色+2egress），errors=0；无模型预检另有同样闭包。
- 2026-09-05 12:46:08Z（北京时间20:46）的原清理回执证明：测试 Chrome/Helpers、Web/Worker、NAS OpenSandbox控制面、SSH转发均退出；本任务运行容器=0、Sandbox residual=0。
- 移除9个旧失败批次已停止的 scratch 容器，但保留每个命名数据卷；当前已通过 scratch、旧source包装和live包装保留为 stopped。
- 当前 auth profile `falcon24-e17-formal-3d5015b7` 和瞬态 capability 文件已删除。
  既有 Keychain服务、较早保存的 auth profile属于保留资产，未宣称全局凭据已清空。
- 同一清理时点普通 NAS PostgreSQL/Neo4j healthy，metatube/qwrt不变，用户 Chrome9741不动，OrbStack关闭；内存free72%。
- 2026-09-05 15:28Z（北京时间23:28）后续只读 NAS SSH 复查出现超时、No route to host / Host is down；
  本地任务进程/端口仍已退出。该后续网络观察不推翻已保存的清理证据，也不能证明 NAS 当前健康；恢复前须重新只读盘点。
- 后续只读恢复必须先核对卷/容器/端口，并确保原物理卷只有一个 PostgreSQL进程。
  禁止同时启动旧只读包装与live包装；严禁用 E16 backup 覆写已提交的 E17。
  如需重新运行产品，要针对当时 HEAD 做 freshness 检查；不可把本次 frozen3d证明当成未来任意代码的凭据。

## AC 与证据索引

审计根：`/Users/lienli/.codex/audit/falcon24-e1-authority-reset`。
正式根：`formal-e17-3d5015b7-f4aad696`。

| 需求 | 权威证据 |
| --- | --- |
| AC-FL-01/02/03/04 | 原15条 business receipt +各题 source/analysis/answer review；仓内证据索引绑定完整题目、Run、hash |
| AC-UI-01/02 | 同15条 QA/Trace回执及原截图；`runtime/control-finalize-1788609924866.json`（PASSED77） |
| 390px | `runtime/control-smoke-390-1788609977606.json`；原A3/B3、无重提 |
| AC-AUTO-01 | 同构建 full-unit/recovery suites；原FAILED保留、本次唯一Run/side-effect审计 |
| AC-AUTO-02 | `complex-03a5a2be/provider-balance-probe-{00,05m,15m,recovery-01}.json` 与原等待checkpoint、后续fresh恢复 |
| AC-FINAL-01 authority | `e17-live-{staged-inactive,finalization,original-port-readback}-3d5015b7.json` |
| AC-FINAL-01 history | `e17-live-{pre-activation,backup,migrations,history-diff,protected-history}-3d5015b7.json` |
| AC-FINAL-01 resources | `e17-final-runtime-cleanup-3d5015b7.json` 与原 `runtime/formal-resource-counts-L2-to-L4.json` |
| 原始证据再验 | `e17-final-evidence-validation-3d5015b7.json`：2026-09-05 15:27:43Z，61份原始回执、30张截图哈希、390px及4次无模型恢复探针校验通过；零模型调用、零authority写入 |
| build/full unit | `.turbo/falcon24-four-layer-3d5015b7/{force-build,full-unit,build-attestation}.log`：8/8 build、15/15 full unit均无缓存、attestation PASS |
| focused validation | 最后修复 Worker20文件229项、typecheck/build/Biome；收尾再验 Web/Platform六文件66项通过，单worker、不启动Chrome/容器；最终文档/索引检查见 scoped commit 与 journal |

历史§18/19的 E11终局、Q1 16/16+C1 30/30、child固定旧五题与旧未勾选 checkpoint均被§20/22覆盖，
保留为历史而非补跑要求。child持续对话在本次两组三轮中收口，不另加模型题库。
