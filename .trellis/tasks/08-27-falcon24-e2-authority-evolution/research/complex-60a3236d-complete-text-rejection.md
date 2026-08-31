# 完整非 JSON 响应的拒绝反馈与复杂链剩余缺口

## 1. 根因类别与证据边界

B 跨层契约 / D 测试覆盖 / E 隐含假设。`60a3236d` force build8/8（0 cache）、full unit15/15、attestation、
专用NAS55505认证及scratch E17 Finalizer通过。A1/A2/B1/B2业务及同Run QA/Trace/刷新通过，节点73/76/61/45。
A2原Run保留一次结果表类型修复；B1/B2由Semantic→Text2SQL完成，不声称执行了Analysis/Report。
A3 `79d9fcf4-45e1-868a-8bf9-fbebc9c220f3` 的唯一Root调用完整结束：stop、
最终/streamed均2843字节、1004个文本块、1002 output tokens、无工具。私有诊断为NON_JSON，
原终态UNKNOWN/RECONCILIATION_REQUIRED、call_count=1；原文未保留，不能断言具体是fence/prose或其他格式。

已确认缺口：原known-empty边界没有覆盖完整观察到的非JSON文本；Root提示仍有非法省略号占位示例。
这两项分别可离线复现/检查，不保证更换示例后模型一定产生合法响应。

## 2. 既有修复为何不足

历史答案包装解决了显示文本冒充协议示例的问题，但本轮A3仍失败；不能把B3终于能委派归因为单一修改。
JSON mode不保证输出有效；重复调用不是验证。保留原失败，不重分类或重派历史UNKNOWN。
离线partial-native反例最初错误预期transport失败，实际固定SDK把不完整参数转成候选`{}`并完成transport。
据此纠正测试：候选不是执行权限，Host严格拒绝参数，且绝不能当作纯文本拒绝。

## 3. 防复发机制

- 仅AUTO原stream完整读取、getFullOutput成功、无abort/error/native活动、stop/length、已报告usage不越预算，
  且非空最终文本与逐块文本逐字相等时，JSON.parse失败才获得独立包内WeakSet标记。
- 新reason `MODEL_RESPONSE_INVALID_JSON`为known/nonretryable；只映射现有持久PROVIDER_PROTOCOL_VIOLATION。
  原terminal提交成功后，Root才接收PROVIDER_RESPONSE_REJECTED，在原四回合预算内checkpoint后开始新正常决策。
  不修补JSON、不扩大Schema、不自动选Agent、不重放Provider、不改DB/RPC/authority。
- 完整有效JSON但Schema错误、未知finish、断流、超预算、文本不一致/native活动均不获标记；复制诊断无效。
- 提示中的示例改为实际Schema解析通过的完整一般知识JSON，明示仅语法、无工作区证据；进入原hash/token预算。

## 4. 系统性展开与独立backlog

B3 `747bd5e0-b82f-8734-a9df-50aaf4d74746` 四次Semantic委派：前三次structured-output拒绝，
第四次接收，但Root预算耗尽，无SQL/Analysis。具体Schema问题没有保留，不能猜字段。
最后上下文保留正确request-only净ROI，却只有渠道/人群/收入/投入及时间覆盖，没有可执行比较窗口；
原题“投入增长但净ROI下降”未给比较期间，覆盖日期不能冒充请求窗口。
下一独立工作项按用户许可明确最近两个完整月，版本化题目，并证明先按渠道汇总筛选、再拆该渠道的人群；
不能用每个人群的筛选冒充渠道筛选，不能平均/求和ROI。旧题/原V1及失败全部保留。

## 5. 知识固化与安全状态

同步Provider authority、Root runtime及F6记录；本仓库无`src/templates/markdown/spec`副本可同步。
离线focused覆盖真实SDK一次fetch、marker、已知/未知反例、Host候选拒绝、持久映射/重放与原Root checkpoint。
Agent Runtime78、Contracts25、Worker75项共178项通过；三包typecheck、Agent Runtime/Contracts build、
owned Biome、Trellis validate及diff check通过（Trellis保留既有大文件注入警告，不依赖截断注入阅读规范）。
这些是实现验证，不是A3/B3或formal15验收。
live348表before/after不变；Web32642/Worker33119、两浏览器及临时auth关闭，55505转发取消、scratch停机保留卷。
共享NAS控制面保留，无Analysis残留；普通NAS healthy、OrbStack关闭、production isolation仍HOLD。
先完成独立语义/分析backlog，再新clean build/fresh scratch；不拼接历史PASS。

审计：`/Users/lienli/.codex/audit/falcon24-e1-authority-reset/complex-60a3236d/`、
`complex-60a3236d-after.json`、`complex-60a3236d-runtime-cleanup.json`。
