# 核心协作验收报告 — 2026-08-31

## 结论与边界

`CORE_COLLABORATION_VERIFIED`：按用户缩小后的范围，四题 **4/4 通过**。Semantic 与 Text2SQL 两道协作题均取得同 Run 的语义上下文、受治理 SQL 和源数据证据；答案、表格、实际图表及 Trace 页面通过检查。

这是 `falcon24-core-collaboration@1.0.0` 任务级验收，不是第二套数据库发布权威，也不是原 FL1 PASSED。旧 15 回合门禁、E16 FAILED 历史和 production isolation=false/HOLD 均未改判；未激活 live E17。
复杂 Analysis、月度分群、多输入与跨 Run 报告按用户本次指示延期。本轮不需要新增全局术语或发布公式；已有语义对象及请求级解释足以完成核心协作。

## 四题证据

固定题目见 [core-collaboration-v1.json](core-collaboration-v1.json)，原文未在执行中替换。

| 场景 | 真实 Specialist 路径 | 业务结果 | Trace 节点/直接产物 | 业务/答案/Trace/刷新 |
| --- | --- | --- | --- | --- |
| C1 收入同比口径说明 | Semantic | 复用订单收入、时间口径；请求级同比解释；未执行 SQL | 21 / 1 | 全部 PASS |
| C2 最近十笔订单 | Text2SQL | 10 条唯一订单与源数据逐行一致，日期降序 | 27 / 2 | 全部 PASS |
| C3 渠道 ROAS | Semantic → Text2SQL | 四渠道投入、收入、已发布 ROAS 与独立源查询一致 | 45 / 3 | 全部 PASS |
| C4 显式净 ROI | Semantic → Text2SQL | 四渠道合计后求净 ROI，与独立源查询一致 | 42 / 3 | 全部 PASS |

每题一个独立 Conversation、一次正常 UI composer 提交。数据库收尾检查确认每个 Conversation 恰有一条用户问题及一个 Run binding；没有重复提问、跨 Run/build 拼接、注入 gold SQL 或预计算答案。
先完成业务复核，再读取同 Run 的答案入口 Trace、所有节点详情、Agent/SQL 视图、直接产物预览和刷新返回。图表非验收前置，但实际提供的图表也验证了数据和独立坐标轴。SQL 作为 QueryEvidence 的依赖被验证及展示，不要求它额外成为直接工具结果。

| 场景 | Conversation ID | Run ID |
| --- | --- | --- |
| C1 | `b31c05b0-a340-4247-9033-a0ab4f954df8` | `cd6f5d2d-9cdf-8ca0-8a29-d3c17faa0ca8` |
| C2 | `77418f04-aad1-4939-94a2-a44935da4d1f` | `835596de-edfe-8d44-8ef1-7d79cfd0182a` |
| C3 | `c2572a45-b647-42a0-84b4-b30b536b504b` | `dee5de88-cdc9-87e8-84cc-49c01bcecaa6` |
| C4 | `58775852-4442-48a5-9745-f114caf54dc8` | `2f8fac90-eea8-8e85-bce1-fb3cbc02ad85` |

## 语义口径及协作证明

- ROAS 复用 `formula.marketing_roas`：`CASE WHEN SUM(spend)=0 THEN 0 ELSE SUM(revenue_generated)/SUM(spend) END`。以实际发布 AST 为准，不把旧说明中的 NULLIF 当成权威。最终 QueryEvidence 中该列角色为 FORMULA。
- 净 ROI 为 `(SUM(revenue_generated)-SUM(spend))/NULLIF(SUM(spend),0)`。Semantic 绑定已发布的营销收入/投入 Metric，生成 REQUEST_ONLY、SUM_BEFORE_RATIO、zero_denominator=NULL 的解释；publication_effect=NONE。最终证据角色为 REQUEST_DERIVED，未伪造全局发布。
- 两题均验证 SemanticQueryContext → SQL typed provenance、QueryEvidence → SQL source_ref，以及 Run/Scope、Release、Datasource、Schema Snapshot、Context package/receipt、target binding 与 hash 一致。Semantic 完成早于 Text2SQL 调用。
- 当前四个渠道的投入合计均非零；零分母分支由发布 AST / 请求解释与 accepted SQL 合同核验，本轮不冒称存在真实零投入渠道样本。

| 渠道 | ROAS | 净 ROI |
| --- | ---: | ---: |
| App | 1.916516641187 | 0.916516641187 |
| Email | 2.048619407502 | 1.048619407502 |
| SMS | 1.985353461320 | 0.985353461320 |
| Social Media | 1.943968017177 | 0.943968017177 |

上述展示做小数舍入；独立源查询及比对保留原始数值、NULL 和完整来源列。

## 冻结构建、数据库及发布身份

验收源码为 clean `ec3c1e61e3258404245e6d7a26e30ef397eef158`；后续报告提交不属于该运行构建。四题记录中的以下身份完全相同：

| 身份 | 值 |
| --- | --- |
| Core profile 原文件 SHA-256 | `5473761f2dc71ad5077d71cdd0b5b6dbd91188b14b0921ae226e442c1b802778` |
| Build generation | `sha256:1daf24ee46befc8d6ba2fee1321a41eca4da4c45643c7bd0d2276c2eb452fced` |
| Web build | `sha256:a596bb9139303d68884cc6ca8db730dc8c85934cc80b0120e6dc73f4d4a9cede` |
| Worker build | `sha256:6a34b97b7f5b1ca6e09af7af307f9c4ba3db3cf4b83c49e267457dae12a2257a` |
| Migration 10815 | `sha256:9db12283ff7d6c9c92ee6cc7b0a273a4e89668f749fd22d3613f59947ff85a1e` |
| NAS scratch container / cluster | `data-agent-falcon24-e17-ec3c1e61` / `falcon24-e17-ec3c1e61` |
| 本机/远端端口 | `55476` / NAS loopback `55476` |
| PostgreSQL system identifier | `7678467078472929314`（物理克隆继承；由独立容器、volume、cluster、port 共同区分） |
| Scratch baseline | `196ff699-390c-58ff-ada3-140fc2c21812` |
| Baseline hash | `sha256:ff0e9c89e94b620996cc0106efb244dabf5d0fd5df8708c167bb7fe5f2a18feb` |
| Scratch activation | `ac3b3db3-fea0-5ead-92cf-f9c71f7aca70` |
| Semantic release / generation | `18472091-59b1-5d86-b399-9605ca627040` / 2 |
| Semantic release hash | `sha256:9c53ca74db82181ff46a591ee4e2b88d63e5c9b4e6e3fa157f10fa085ca74dd6` |
| Datasource | `37653002-af62-53c9-bf21-519468aa39ab` |
| Datasource hash | `sha256:2b270a4442f1e8d8a376b7902268a06ebcc099fa2ca386a3ebff5f4e3606e1fc` |
| Model profile / revision | `0e9a602e-4af0-5d69-a227-3906a703d28b` / 2，`deepseek-v4-flash` |

NAS pg_basebackup / pg_verifybackup 成功；克隆激活前 348 张受保护表与 live 完全一致。相比旧审计的 347 张，新增统计的是 `platform.migration_ledger`，没有缺表或缩减验证。源数据证明为 9 表、70 列、121445 行、1902 个 NULL；retained source/catalog/subject 身份一致。
原 recovery certification PASS、原 Finalizer 仅激活 scratch。全部四题完成后 live 348 张表的 count + canonical SHA-256 与 before 完全一致。

## 回归、失败历史与使用量

`fa03e0ed` 提交新范围和延期草稿；其 full unit 暴露分面字段破坏 DeepSeek Strict 投影的问题，未以该构建创建新 scratch 或调用模型。
`ec3c1e61` 将 chart binding 表达为两个 closed/all-required 对象分支，保留旧/新 payload、版本和 refinement，不放宽 provider 投影器。实际 model/authority schema 三个新增回归先 RED 后 GREEN。

- 修复相关 focused：Agent Runtime 15 + Contracts 11 + Worker 84 = **110 PASS**；三包 typecheck、Contracts build、Biome/Trellis/diff 检查通过。
- 新 clean force build：**8/8、0 cache**；全仓 unit 命令：**15/15 task、6 cache**。该命令的 Worker 子集为 97 项，Web 为 645 passed / 1 skipped；不把 task 数当成测试总数，额外 84 项 Analysis focused 单列。
- 同一构建 attestation PASS；四题运行过程中没有源码变动。
- C3 首个 SQL candidate 因 `TEXT2SQL_PUBLISHED_FORMULA_EXPRESSION_MISMATCH` 被拒绝，在同一 Run 按发布口径合法修正后成功。保留 seq=28 的拒绝记录，没有再次提问。
- C3 只读 verifier 曾错误要求 SQL 同时出现在直接工具结果中；按既有 typed provenance / dependency 合同纠正后重验同一 Run，没有改产品、模型输出或数据库证据。`failure-1788151883388.json` 原件保留；原 `result.json` 的 `prior_harness_failure_preserved:false` 是模板遗留错误，未覆盖旧文件，聚合报告明确标出这一元数据差异。不能据 v8 标签声称四题验证器字节始终相同。
- Worker 启动曾因既有 Sandbox orphan sweep 服务未启动而失败；恢复原 NAS 依赖后启动成功，发生在首题之前。未启动 OrbStack、未绕过检查。

| 场景 | 模型请求完成记录 | 有 usage / 未报告 usage | 已报告 token 小计 |
| --- | ---: | ---: | ---: |
| C1 | 2 | 1 / 1 | 9847 |
| C2 | 2 | 1 / 1 | 27477 |
| C3 | 5 | 3 / 2 | 44483 |
| C4 | 4 | 2 / 2 | 23794 |
| 合计 | 13 | 7 / 6 | 105601 |

仅汇总四个业务 Run 的去重请求完成事件：已报告 input=103484、output=2117。六条未提供 usage，故**完整 token 总量未知**；小计不是完整账单，且不包含 recovery certification。未把缺失用量当成零。

## 清理与交付状态

- Web PID 28460、Worker PID 36491、OpenSandbox PID 35601 在验证 cwd 后正常停止；3300/9090/18080 已释放。
- 四个本轮浏览器 session 均关闭，对应临时 auth vault 均删除；本轮 scratch capability 本地文件删除，不宣称因此撤销数据库内已签发记录。既有 Keychain 共享凭据未改动。
- 本轮 scratch 容器正常停机（exit 0），专用 volume `data-agent-falcon24-e17-ec3c1e61-pgdata` **保留为可恢复证据 checkpoint**，未删除数据库；55476 forward 精确取消，端口释放。
- 原 SSH master、其他 forward、旧失败克隆/backup/audit、旧浏览器及他任务资源未批量清理。普通 NAS PostgreSQL/Neo4j 仍 healthy，OrbStack 未运行。
- 当前核心里程碑 COMPLETE；原父任务及其未完成 child 保留关系和历史，不因本次四题交付自动归档或冒称复杂业务/正式发布完成。继续完整四层或生产发布需要单独恢复对应范围及门禁。

## 证据定位

本地证据根目录：`/Users/lienli/.codex/audit/falcon24-e1-authority-reset`。这些是实际运行观察，不是 formal gate receipt。

- [核心聚合证据](</Users/lienli/.codex/audit/falcon24-e1-authority-reset/core-ec3c1e61-closure.json>)：四题 source/profile/binding、原问题、Run/Conversation、answer/public-event/Trace/artifact hashes、持久化配置、usage、全部 JSON/PNG 字节 hash 和原 harness failure。
- [运行环境清理记录](</Users/lienli/.codex/audit/falcon24-e1-authority-reset/core-ec3c1e61-runtime-cleanup.json>)、[live 前后比较](</Users/lienli/.codex/audit/falcon24-e1-authority-reset/core-ec3c1e61-after.json>)。
- 各题目录 `e17-{semantic,orders,roas,net-roi}-canary-ec3c1e61` 内含 intent、单次提交记录、独立 oracle、business、QA、Trace source、result 和页面截图；渠道两题另有 `collaboration.json`。
- 同根目录 `e17-physical-clone-ec3c1e61.json`、`e17-dataset-proof-ec3c1e61.json`、`e17-scratch-certification-ec3c1e61.json`、`e17-scratch-finalization-ec3c1e61.json`；构建日志与 attestation 位于 worktree `.turbo/falcon24-four-layer-ec3c1e61/`。

复核这些保留证据不需要再次调用模型。重新启动已停止 checkpoint 时仍需显式核对隔离 binding 与运行构建，不允许用报告提交的 HEAD 冒充原构建。
