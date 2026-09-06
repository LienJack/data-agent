# Falcon24 E17 切换任务窗口接续计划书

> 交接日期：2026-09-06。用户最新要求：先 commit、push，再整理计划书并切换窗口。
> 本文件是接续索引，不是第二套发布权威；需求以当前 Trellis PRD §20、§22（截至22.35）及后续明确修订为准。

## 1. 当前结论

四层业务验收已通过，不再是“只有四题通过”：同一冻结构建、同一 scratch attempt 的 L1五题、L2两题、L3两题、L4两组三轮，共15回合，均完成业务复核和同 Run Q&A / exact Trace 验收。
其后独立完成 fresh live E17 认证、激活、原生产代码读回、历史保护审计和资源清理。

本次交接尚不把总任务标记 COMPLETE。剩余是最终需求条目/父子任务状态对齐、归档与 journal、提交和干净工作树的闭环。
生产隔离仍为 `production_isolation_proven=false / production_gate=HOLD`；业务通过不等于生产上线许可。

## 2. 唯一接管位置与 Git 状态

| 项目 | 接管值 |
| --- | --- |
| Owning worktree | `/Users/lienli/Documents/GitHub/data-agent/.worktrees/codex/falcon24-e1-authority-reset` |
| 分支 | `codex/falcon24-e1-authority-reset` |
| 远端 | `origin` → `https://github.com/LienJack/data-agent.git` |
| 已推送的验收/规范提交 | `87907989`，`docs(falcon24): record four-layer evidence and resource lifecycle` |
| 实际通过业务门禁的源码 | `3d5015b7d28dc37857203f7eab3ad2fd92c9bf53` |
| 后续文档提交 | 本计划书在上述提交之后单独提交；接管时以 `git log` 和远端精确 SHA 核验，不把文档 HEAD 当成新的受测运行时 |
| 当前 Trellis 任务 | `.trellis/tasks/08-27-falcon24-e2-authority-evolution`，`in_progress` |
| 关联 child | `.trellis/tasks/08-27-conversational-root-harness`，`in_progress` |

主目录 `/Users/lienli/Documents/GitHub/data-agent` 是另一 checkout（`dev`），当前有无关生成文件 `apps/web/next-env.d.ts`、`apps/web/tsconfig.tsbuildinfo`；本次未提交、未恢复、未覆盖它们。
此次 push 只针对 owning 分支，未合并到 `dev`/`main`，未创建 PR，未发布生产。
旧执行任务 `01a03dc9-07bc-7b63-ac1a-5c4458c750dd` 不再承担实现；不要向它派发，也不要另建第二条发布执行链。
当前交接来源任务为 `01a04241-de28-74e2-afd4-9c6cd81078dc`。

## 3. 先读这些文件

按顺序读取，先掌握最终结果，再查需要的历史，避免倒退到旧 E4/E11/F6 checkpoint：

1. [根级 AGENTS.md](../../AGENTS.md)：禁用 CE/Compound、scoped commit、资源生命周期。
2. [当前 task.json](../../.trellis/tasks/08-27-falcon24-e2-authority-evolution/task.json)。
3. [四层验收与 E17 发布报告](../../.trellis/tasks/08-27-falcon24-e2-authority-evolution/research/four-layer-final-verification-3d5015b7.md)。
4. [15回合完整题面与证据索引](../../.trellis/tasks/08-27-falcon24-e2-authority-evolution/research/four-layer-final-evidence-3d5015b7.json)。
5. 当前任务 [PRD](../../.trellis/tasks/08-27-falcon24-e2-authority-evolution/prd.md) §20/§22、[design](../../.trellis/tasks/08-27-falcon24-e2-authority-evolution/design.md) 最新相关决策、[implement](../../.trellis/tasks/08-27-falcon24-e2-authority-evolution/implement.md) F5/F7。
6. [资源运行规范](../../.trellis/spec/backend/local-runtime-modes.md) §8/§9 与 [资源清理复盘](../../.trellis/tasks/08-27-falcon24-e2-authority-evolution/research/resource-cleanup-retrospective-3d5015b7.md)。
7. 对齐 child 时读其 [implement](../../.trellis/tasks/08-27-conversational-root-harness/implement.md) 顶部最新范围说明；旧 C7 五轮/六问失败文本仅保留历史，不能据此再加一套模型题库。

## 4. 已完成与不可混淆的证明边界

### 4.1 同批业务及 UI

- Scratch attempt：`f4aad696-8118-40a5-86e1-36bbc80765e9`，原 Finalize 为 `PASSED/version77`。
- Scratch baseline：`83c87151-0b89-58c0-b870-18988a28cf6a`；manifest v10，15个唯一 Run、11个 Conversation。
- L1：Semantic、Text2SQL、Report 独立能力；L2：Semantic → Text2SQL；L3/L4：Semantic → Text2SQL → Analysis。
- L3/L4 的表、图和解释由实际 Analysis 路径生产，不虚称额外调用独立 Report Profile。B2/B3 同一 Run 内有真实 ToolResult 驱动的第二次 Text2SQL 委派，不是人工重提或 Run 重放。
- A组 Conversation：`cc40b8a8-0903-5b0c-94e0-9768f5efa632`；B组：`48eb120b-d1fa-544e-9bda-9d4566b30373`；每组三轮复用同一页面。
- 所有业务源 Oracle / Analysis Oracle /答案复核先通过，随后才验原 Run 答案和 exact Trace。30张截图、原 A3/B3 的390px smoke已通过，没有为截图重新调用模型。
- 最终 Report 答案确实披露缺失单位/币种/倍率；不能只凭旧 rubric PASS 或 prompt 单测推断。
- 100次内部请求中65次报告 usage，input887895/output33589只是已报告子集；35次 unavailable，不计为0，不推算总费用。live认证另计。

### 4.2 Live E17 发布

- Live baseline：`3c995b1c-d25f-5694-99f5-56903dfdc8ac`。
- Live activation：`09263549-b514-5391-97c7-aa6b07a1e0cf`。
- Certification Run：`96eb3fce-d96a-50ab-a2f9-7d7c2c8e17dd`，fresh、replayed=false，先 STAGED/inactive 再由原 Finalizer 激活。
- Live 与 scratch 绑定同一 frozen build/release/profile，但 baseline不同；没有将 scratch Run搬到live，也没有声称live重跑了15题。
- migration10816–10825已经前向应用，当前E17已发布；不要重新调用 certify/finalize/restore/migrate helper。
- 9表70列121445行1902NULL的数据快照及发布闭包读回一致；328表全表不变、18表仅追加、旧行无删除，仅两条合法 mutable-head更新。
- 原 E1–E16、gen1/gen2、旧 Run/Artifact、失败记录及 audit stash均保留，不能修补或覆写历史。

### 4.3 验证记录

| 验证 | 已保存的结果 |
| --- | --- |
| frozen source构建 | 8/8，强制构建、缓存0 |
| frozen source全量unit gate | 15/15，缓存0、串行；一个既有Web集成skip，未冒充执行通过 |
| 最后源码修复focused | Worker20文件229项、typecheck/build、owned Biome通过 |
| 收尾focused | Web/Platform6文件66项通过，未启动Chrome/容器 |
| 原始证据再验 | 61份回执、30张截图hash、390px、live/history/cleanup及4次无模型恢复探针通过 |
| 本次提交前只读再验 | 2026-09-06 04:44:10Z再次通过同一证据校验，未改写原回执、零模型调用、零authority写入 |
| 文档检查 | Trellis validate与diff检查通过；原有3份超大context文档截断警告仍在，不声称告警清零 |

`.trellis`文档不在Biome配置处理范围，不能把“processed 0 files”当成 lint PASS。本轮是文档交付，不重跑已经封存的昂贵业务验收。

## 5. 数据库与资源恢复边界

### 5.1 上次已证明的状态，不等于当前在线状态

- 原清理回执时间：2026-09-05 12:46:08Z，即北京时间20:46。本任务运行容器=0、Sandbox残留=0；测试Chrome/Helpers、Web/Worker、NAS控制面、SSH转发已退出；OrbStack关闭。
- 清理时普通NAS PostgreSQL/Neo4j healthy、metatube/qwrt不变；用户Chrome保留。删除9个旧已停止scratch容器，但所有数据卷、当前通过scratch、live包装、backup及证据均保留。
- 此后2026-09-05 15:28Z（北京时间23:28）NAS SSH出现超时/No route to host/Host is down。该观察不推翻先前清理证据，也不能证明NAS现在可用；本次交接没有重启NAS服务。
- 2026-09-06本地只读复查未发现匹配的Chrome-for-Testing/OrbStack/agent-browser/next-server进程，3300/9090/18080/55433/55566无监听。此检查不能代替远端盘点。

### 5.2 必须精确保留的物理对象

| 对象 | 绑定/要求 |
| --- | --- |
| NAS入口 | SSH alias `data-agent-nas`，数据库远端仅loopback |
| 原物理system identifier | `7678467078472929314` |
| 原live数据卷 | `data-agent-falcon24-e1-e81a29c6-pgdata` |
| 旧只读包装 | `data-agent-falcon24-e1-e81a29c6`，保留stopped |
| E17 live包装 | `data-agent-falcon24-live-e17-3d5015b7`，清理后stopped，NAS loopback55433 |
| 当前已通过scratch | `data-agent-falcon24-e17-3d5015b7`，stopped，数据保留 |
| E16保护backup | `data-agent-falcon24-e16-pre-e17-3d5015b7-backup`，验证后从未启动，不得覆写当前E17 |
| audit stash | `164b4bf2bf3ba83e5286f4145ae2f27debc53135`，只保留，不restore/drop/执行 |

旧只读包装和live包装挂载同一物理卷，绝不能同时启动。普通NAS `data_agent`库不是Falcon authority，不能为了方便改binding。
当前browser auth profile和本轮瞬态capability文件已删除；既有Keychain及较早auth资产保留。任何Secret只能由既有安全机制获取，不能粘贴到计划、Git或日志。

### 5.3 后续测试预算

- 一个浏览器会话，通常一个活动页；独立题同会话换页并关前页，L4同组不换页。
- 一个当前scratch；Analysis最多一个活动会话。当前NAS结构为两隔离角色+两个egress，Sandbox峰值4，另计scratch，共5个任务测试容器；Python控制面是进程，若以后容器化需另计。
- 物理备份/恢复探针与业务测试串行，临时探针最多1个；按真实运行拓扑记录before/peak/after，不把固定数字当成免盘点许可。
- build/full unit/DB/browser E2E串行；NAS模式禁止启动OrbStack。不要运行auth list/show仅为收尾检查，因为它可能创建轻量daemon。
- 只按已核实任务归属的精确PID/容器清理；close/stop返回不代表进程已退出。禁止全局pkill/prune和删卷。

## 6. 新窗口的最小执行计划

### P0 — 只读接管与防漂移

1. 在唯一owning worktree核验 `git status --short`、分支、HEAD、upstream、最后两次文档提交；不在主目录误操作。
2. 读上述权威文件与原始回执。确认受测source仍为3d5015b7，文档HEAD不是新的运行证明；不重做F1/F6、不回放已完成的发布命令。
3. 核对本地进程/端口；仅当确需恢复产品或新做远端读回时，先做有界SSH只读盘点，确认容器/卷/标签/端口/system identifier。网络仍不通就记录当前事实，不修网络、不启动VM、不伪造health。

**完成条件：** Git所有权和证明身份清楚；没有重复执行链；确认是文档收口，还是发现了真实、可定位的证据缺口。

### P1 — 完成最终需求与父子任务对齐

1. 在父任务追加最新F7收口说明，逐项把AC-FL/UI/AUTO/FINAL与报告证据对应起来。旧未勾选checkpoint保留历史并注明被最新范围覆盖，不能大批勾选伪装旧attempt通过。
2. 在child追加本次L4六回合的验收索引，注明旧固定五轮/六问不另跑；不要改写旧失败结论。只完成与本次已证实能力相符的当前条目。
3. 审核AC-FINAL剩余的scoped commit、clean worktree、task状态要求。当前task.json已从旧F6更新到交接checkpoint；不要依据旧notes恢复到E4。
4. 如未发现产品源码缺口，不改源码、不重跑15题、不重新认证/激活。只有真实新代码变更才走对应focused validation和新scoped commit；影响冻结运行时的变更必须另立fresh proof，不借用旧PASS。

**完成条件：** 父子任务的当前未完成事项与事实一致，证据链接有效，全部最终条目都有明确证明或如实的范围排除；生产隔离仍HOLD。

### P2 — 最终归档与交付

1. 做轻量JSON/链接/合同检查、Trellis validate、`git diff --check`；本轮无代码变更时不为了归档新开Chrome/Docker。
2. 显式stage本任务路径，提交收口文档。检查其他窗口没有新增并行改动，禁止`git add .`、amend、reset或force push。
3. 在全部当前AC满足后，按Trellis先归档相关child，再归档当前E2任务，记录journal；不要归档无关的08-24任务或更上层未确认完成的父任务。
4. 将后续owned提交推送到同一远端分支，核验远端SHA与本地一致及owning worktree clean。
5. 只有上述条件真正满足才标记整体完成；如果新窗口没有当前goal控制权，就明确报告完成范围，由用户/原任务管理其goal状态，不伪造状态更新。

**完成条件：** 四层证据不变、当前AC对齐、owned提交已推送、工作树干净、相关Trellis任务与journal闭环；最终答复明确“业务验收通过，production isolation仍HOLD”。

当前没有理由因切换对话窗口而自动重跑门禁，也没有授权合并到dev/main或部署生产。

## 7. 原始证据与迁移限制

审计根：`/Users/lienli/.codex/audit/falcon24-e1-authority-reset`。
正式根：`formal-e17-3d5015b7-f4aad696`；其下 `runtime/f7-fifteen-turn-matrix.json` 的SHA-256为：
`71e233bd41a69852452c019114b638d4f6af7f45dd749f61b8f9c940b93b2e7b`。

重点只读文件：

- `runtime/control-finalize-1788609924866.json`：PASSED77。
- `runtime/control-smoke-390-1788609977606.json`：原A3/B3、submitted=false。
- 审计根 `e17-final-evidence-validation-3d5015b7.json`：61原始回执/30截图验证。
- 审计根 `e17-live-original-port-readback-3d5015b7.json`、`e17-live-protected-history-3d5015b7.json`、`e17-final-runtime-cleanup-3d5015b7.json`。
- owning worktree `.turbo/falcon24-four-layer-3d5015b7/`：原build/full-unit/attestation日志。

仓内只提交脱敏摘要和hash索引；完整截图、原回执、运行产物、物理数据库卷和Keychain不在Git中。
同一台机器切换窗口可按原绝对路径读取；换机器或云端仅clone不能复现原证据。若文件缺失，应先报告并按用户授权转移证据，不能伪造回执、凭据或PASS。
`.turbo/falcon24-formal-support/`中的certify/finalize/restore/migrate helper多为一次性脚本，已经执行完成，不得批量重跑；即使只读验证器也可能以`wx`写审计文件，已有原文件不得覆盖。

## 8. 可直接发给新窗口的接管消息

```text
请接管 /Users/lienli/Documents/GitHub/data-agent/.worktrees/codex/falcon24-e1-authority-reset，分支 codex/falcon24-e1-authority-reset。
先读 docs/plans/2026-09-06-falcon24-e17-handoff-plan.md，再读其列出的最终报告、证据索引与当前Trellis PRD。
当前不是四题通过：受测source 3d5015b7的同一scratch attempt已15/15 business+QA+exact Trace通过；独立live E17认证、激活、历史和清理已通过。
只从计划P0开始只读接管，再完成P1/P2的最终条目对齐、相关child/当前task归档、journal、scoped commit与push；不要重跑旧F6或已完成的15题/激活。
NAS最后清理健康证据与后来SSH失联须分开表述；先核验当前现场，不能因网络问题启动OrbStack或误用普通data_agent库。
严格单线执行、单浏览器会话/通常一个活动页；统计scratch+Sandbox角色+egress全部容器，重型任务串行，保留全部卷和证据。
禁止Compound/ce-*；保护并行改动；不伪造Secret/审批，不拼PASS，不宣称production GO。生产隔离仍HOLD。
用户已授权当前计划实施及本任务scoped commit/push，无需再次询问是否批准；若出现实质新范围或不可安全判断的目标，再明确询问。
```
