# E17 复杂能力前置审计

日期：2026-08-31。观察构建 `cc9ff33eff80f35792e84cddef2c832d4768847a`。

## 已有证据与边界

五项基础scratch回归均通过，详见 implement 的对应 Run/审计目录。生产live仍为E16 FAILED，未激活E17。
成功只覆盖语义、10行明细、12月同比、全量渠道ROAS/净ROI；没有正式评分、复杂Analysis或跨Run通过证据。
本轮服务/browser/vault关闭，物理副本和完整证据保留；不消费额外模型调用来复现已知代码限制。

## 代码确认的限制

1. `apps/worker/src/analysis/production-governed-analysis-runtime.ts`：唯一生产composition的 methodRegistry
   无条件调用 compileSingleSeriesAnalysisPlan，只返回 published-single-series-trend；oracle固定createSingleSeriesAnalysisOracle。
2. `single-series-analysis-planning.ts`：输入要求12行/2列、一个MONTH Dimension、一个NUMBER Metric；Context必须恰好1 Metric。
   因而渠道×人群、多指标与同比4列不能直接进入该方法。现有模型编排、Sandbox、原子publisher是可复用执行链，不是缺失服务。
3. `postgresql-query-evidence-semantic-binding.ts` 与 `postgresql-request-derivation.ts`：ratio拒绝任何current window/WHERE/
   时间Dimension；当前全量净ROI的成功不覆盖按月比较。后续只允许 exact accepted current window，不能放开任意过滤。

## 实施顺序与可验证切片

1. 复用原请求比例证明，补同物理时间列/双指标coverage、精确上下界、MONTH bucket与已有分类维度；不新增解释算子或发布对象。
2. 按真实输入形态及原发布analysis capabilities补方法注册/ResultContract/独立oracle。禁止按case ID、关键词或答案挑选路径，
   禁止把request-derived结果当成新的Published Metric授予方法权限。已有单序列方法不能退化为无校验兜底。
3. 核查复杂多表输入、分群比较、跨Run指代和报告图表组合。当前只标记待验证，不把可能可执行的路径认定为已通过。
4. 聚焦验证和分项commit后，再做最终同构建fresh scratch/正式15题。任何旧PASS不拼入新build。

## 第一个小项的预定反例

缺少/删掉时间窗；声明与WHERE参数错位；改变边界、时区或一侧coverage；未选/未发布时间Dimension；错物理时间列；
月桶变day、text time未经timestamp cast；额外WHERE/OR/HAVING/隐藏group；整数截断；原指标/Formula重标派生结果。

本记录是能力审计与实施依据，不是新业务PASS或正式epoch激活授权。

## 第一个小项验证结果

- 共享resolver复用原接受Context/receipt与精确发布对象，比例输入允许其完整月份窗口；两指标都必须有非空min/max并覆盖窗口、
  同时区/时间列和Dimension权限。WHERE参数与声明逐一对应；仅原时间列月桶和分类键分组。旧全量hash/数值证明未改。
- Platform五个focused文件308/308；Worker四个focused文件136/136；双方typecheck、Platform build、9个TS文件Biome通过。
  初始新增纯SQL正例与诊断14失败、Context正例3失败；修复后通过。额外null coverage负例先失败，再以显式非空边界检查闭合。
  未发布/未选择/未请求时间Dimension均以明确binding错误拒绝；未扩大预算、候选修复次数或publisher。
- 真实只读SQL探针使用 `falcon24-e17-cc9ff33e` / 55475、事务只读，读取原全量净ROI Run
  `279c33d8-5ef4-83f8-a6e7-52de360f46c1` 的来源信息，**不修改其Context**。原Context没有时间Dimension，因此探针明确不运行完整
  Workercompile/接受链，不签发新receipt，不把原全量Run改造成带窗Run；仅以纯SQL证明和独立源数据oracle检查计算。
  得到12个月×4渠道共48行，date/text/float OID一致，窗口内源SUM、净ROI及零分母NULL规则核对PASS。
  记录：`/Users/lienli/.codex/audit/falcon24-e1-authority-reset/e17-net-roi-canary-cc9ff33e/monthly-sql-readonly-probe.json`。
  `provider_calls=0 / authority_writes=0 / artifact_commits=0 / formal_gate_pass=false`。
- 后续新Run仍必须正常取得已接受且含时间Dimension的Context；再证明全部生产路径和真实模型问答。当前不激活live E17，
  下一小项仍为生产Analysis的形状/能力驱动方法和独立oracle，旧五项canary仅保留历史证据。

## 第二个小项：重复Metric的精确直接投影

`buildGovernedResultProjections` 原先仅按role/object_id定位输入：本期与同期共享Metric时必然二义，不能靠“第一列”修复。
在原ResultContract@2的column mapping加入可选显式source，进入相同hash并受DIRECT physical lineage校验；Worker额外精确匹配
input/output而不删除role/ID证明。真实Arrow fixture证明12个月、本期/同期不同值和NULL保留；错输入/列/身份/角色/类型/NULL，
重复输入、跨输入拼表、Arrow篡改及无source二义性均拒绝。Contracts41/41、Worker71/71、两包typecheck/build通过。

本小项没有生产方法注册、候选预算或发布器变更。后续仍须解决FORMULA/REQUEST_DERIVED输出角色闭包、通用有界方法与独立oracle；
全量Analysis的非空Brief时间窗约束和跨Run组合仍未完成。当前只读工程审计不能记为这些业务能力通过。

## 第三个小项：比例列进入结果但不成为发布Metric

原ResultContract表枚举和staged chart parser不接受FORMULA/REQUEST_DERIVED；Program Compiler只允许原指标/维度lineage。
现在为这两类列强制NUMBER/DIRECT/source/lineage并禁止metric_bindings；Compiler从原resolveCommitted输入重验Run/Scope、Context、
Release/Schema与列的exact identity，仅允许已经证明的结果lineage。Metric和方法能力集合不变，REQUEST_DERIVED依赖必须在节点原选择内。

Contracts43/43、Worker92/92、两包typecheck/build通过；13类authority drift、未接受来源、Metric升级都失败关闭。
真实Arrow fixture保留原角色与NULL；staged chart parser三role读取回归通过。没有模型Run、数据库写入或新方法注册。
进一步审计确认 `ArtifactWorkspaceChartProjectionV3` 当前拒绝任何y=NULL，而同比有真实缺失同期值；须独立闭合V3空值图表，
不改旧V2文档、不补零、不丢月份，也不能先把数据方法记作可正式执行。

## 第四个小项：V3空值投影贯通

新transform1.1保留LINE/BAR/HORIZONTAL_BAR的真实NULL及完整行，每个measure至少一个真实值，统计推断样本条件仍由具体方法验证。
旧1.0非空golden hash保持，NULL不得放入旧版document/preview；七种其他图类维持严格完整数值。Platform旧趋势投影的删行和
delta补零同时消除，全空序列不发图；Worker及Web完整行/NULL/断点验证通过，来源、oracle和hash链不变。

Contracts36/36、Platform19/19、Worker52/52、Web18/18，四包typecheck及Contracts build通过。先观察8个新行为Contracts失败、
1个Platform失败和3个Worker失败再修复；旧hash取自修改前实现并固定。无模型调用、数据库写入或正式验收。
下一项仍为具体生产方法与独立oracle，不因图表可解析就把Analysis/跨Run业务验收记为已通过。

## 第五个小项：月度多结果方法的输入/输出契约

限定为一个MONTH维度、2–4个NUMBER结果列、12个连续完整月。保留同Metric的本期/同期及比例角色；原Metric必须具备
CHART_DATASET并通过原applicability，不调整任何方法预算。输出逐measure描述性字段及DIRECT原始表图，Host提供字段Schema/
计算规则而非预计算答案；明确缺失值、原始端点和相邻月边界，不作统计显著性或因果声明。

23个新测试覆盖角色/NULL/精确映射、列序/别名/行序/DATETIME、来源与发布能力漂移和非法形态；连同原编译/投影/发布回归83/83，
Worker typecheck/build通过。本次仅新增编译叶子，没有production注册或真实模型Run；独立oracle和现有生产composition接线紧接着执行。

## 第六个小项：月度多结果独立oracle

用原QueryEvidence/实际Arrow计算描述性期望，再比对全部RESULT/TABLE/CHART以及来源、字节数、hash与ref；不读取模型计算来生成期望。
测试正例为手写已知数值，32项覆盖重新封hash的篡改、填零Arrow、零分母端点、不能跨缺失月相减和有限输入的运算溢出。
FULL严格限于固定描述性合同，不授予统计/因果或material-change阈值结论；implementation hash包含oracle模块摘要和执行规则。

新32项加原编译/投影/发布/叙述回归共117/117，Worker typecheck/build、4文件Biome通过。只把原时间窗函数抽出供Brief与oracle复用，
旧单指标方法与规则未改。没有生产注册、模型调用或数据库写入；继续接唯一production composition，然后再证明真实执行链。

## 第七个小项：唯一生产composition接线

原两列单指标继续统计趋势方法；多列输入须完整通过月度比较编译器，问题文字不参与选择。新增Host-only execution_contract
随原registry hash封存，只进入匹配节点的执行上下文；新/旧oracle均按exact method/skill/contract绑定，无兜底或预算扩大。
4个生产接线回归先因旧单序列形态限制失败；修复后10文件132/132，Worker typecheck/build通过。新方法关键数值经过叙述投影保留，
原方法删算子仍失败，错方法与缺规则拒绝。本项不含真实Sandbox/模型/浏览器运行或正式PASS，live仍E16 FAILED。

## 第八个小项：全量输入不虚构时间范围

无窗QueryEvidence现在可以经原Brief进入显式Program1.1（candidate2.1/envelope1.1）；Compiler重验原接受输入及Context/Run/资源，
Gate对null也必须精确匹配。只支持无时间grain/无统计算子/无比较窗的open-python节点范围，未注册渠道方法或扩大capability。
Host新增approved_time_window，拒绝从coverage猜日期。原有窗Program仍1.0，旧封包hash与2.0/2.1有窗编译结果完全相同。

Contracts59/59、Worker144/144、Platform42/42，四包typecheck及Contracts/Worker build通过；新增范围8项预期行为先RED，
3项负例fixture的Context须先剥离旧hash再重封，修正后重测通过；新Wire正例先RED，旧hash从改动前实现固定。
这是契约、发布封包和消费方离线验证，不是Sandbox/模型/数据库写入或四层PASS。接续分类/分群方法、独立oracle及跨Run闭包。

## 真实来源nullable复核与修正

只读连接原专用scratch55475，验证cluster=falcon24-e17-cc9ff33e、transaction_read_only=on。三个原QueryEvidence表明列元数据均可能
nullable=true。同比Run `9f17195a-11d5-86ac-be35-2f25f4123abc` 的原QueryEvidence
`cf2377c3-708d-8e67-a71d-6499b32d7e19`（hash56652d942b16a62ed96d2091bb1946f769008a336dfcc4e8b822b148ef0ece9f）
实际为完整12月DATETIME，首月UTC2023-10-31T16:00:00Z即上海11月1日。原新方法错误地先拒绝nullable元数据。

现在保留原nullable，逐行检验实际日期/连续性；两个DATE/DATETIME反映此现场的正例先RED后通过。84项focused、Worker typecheck/build通过，
同一只读原输入shape复核PASS；实际空时间/重复/缺月仍拒绝。没有构造新Context、模型Run、receipt或数据库写入，不是完整Analysis验收。
ROAS/净ROI仍为4渠道、2个原currency Metric及一个FORMULA/REQUEST_DERIVED，time_window=null；两原Metric相同grain、单位、时区，
均有CHART_DATASET。后续分类方法必须按真实值判空，保留这些原角色/NULL和方法权限。

## 分类比较方法叶子

按上述真实形态新增1–2维/1–4结果/≤200行分类比较契约，原Metric1–3个并通过原applicability；无混单位/粒度兜底。
完整tuple不合并，原始行序及NULL保留，第二分类直接作series；描述性极值/计数/各3个排名以原行号打破同值，禁止比率均值/自由事实。
新22项加原编译/发布共75/75、Worker typecheck/build及3文件Biome通过。初始模块缺失RED；fixture须完整声明原ratio聚合与零分母规则，
未修改原来源schema。没有生产注册、oracle、模型Run或数据库写入；继续独立oracle和生产接线。

## 分类独立oracle与唯一生产接线

原来源/真实Arrow重验后从源行独立计算所有计数/极值/排名，完整比对RESULT/TABLE/CHART、scope/run和bytes/ref/hash。测试正例用手写已知值，
反例重封hash仍不能通过；额外自由事实、因果、补零、漏第二分类/换序/错绑定均拒绝。FULL只覆盖固定描述性合同，material_change=false。
仅抽出月度/分类公共字节与引用闭包，不共享业务期望；实现摘要绑定各oracle叶子及公共helper。production按输入形态完整编译，问题文本不参与，
exact method/skill/contract与Host规则必须匹配；原single-series统计与月度路径不变。

初始RED是新oracle模块不存在；实现后先154/154，再加入生产接线回归共10文件185/185、Worker typecheck/build通过。
分类30项含真实Arrow投影、1/2分类×FORMULA/REQUEST_DERIVED、NULL/叙述保留及生产selector；fixture的stub Sandbox receipt只用于unit边界，
不是服务/执行/数据库回执。无模型Run、无权威写入；当前尚不能据此启动正式E17，剩余月份×分类、混单位/多输入和跨Run报告继续闭合。

## 月度分群的三维显示前置

旧图表x+series不足以保存月×渠道×客群身份。新V3 facet_key明确引用原分类，transform1.2封hash，完整原表不变；不造复合source、
不改变统计/来源授权。Web按原分类再按measure分区显示，原series/NULL/顺序保持，最多16分面且原全表限制不增加。
初始6项新版本行为RED，随后Contracts53/53、Web26/26、四包typecheck、Contracts build通过；旧非空golden hash不变。
这只是读取/显示契约和静态组件证据；尚无producer/Trace接线、新方法、真实浏览器/模型或数据库写入。下一小项沿原publisher补齐。

## 原publisher/Trace的显式分面闭包

模型facet声明经Host选publish1.1，publisher只引用原STRING/DIMENSION表列，Chart1.1由Worker映射到V3 transform1.2；无facet保留原格式。
真实Arrow源行/NULL经既有暂存publisher完整保留，显示变化不改RESULT/TABLE字节；各层hash包含facet。原方法仍由原独立oracle拒绝新增图字段。
初始Contracts版本正例和模型绑定正例各RED；中间发现精确optional类型需包含undefined后修正，无类型断言绕过。
Trace两个重新封hash的缺列/非DIMENSION反例先实际返回ok:true，补共用source校验后拒绝；原canonical/metadata/Scope/Run边界不变。
最终Contracts53/53、Worker8文件145/145、Platform40/40，四包typecheck及三包build通过。新publisher测试中的空measure JSON仅用于暂存边界，
不是独立oracle或完整Sandbox证明。未调用模型、写数据库或启动正式E17；下一步完成月度分群方法，不把该显示能力当业务验收。

## 分类行数闭包纠正

编译器最初允许200行但其必需BAR图仍为原64行上限；若不处理，会在分析完成后才拒绝显示。现方法/合同/rank schema统一收紧64，
不增加预算、不丢弃source行；64/65两个反例先RED，64行同时通过原V3 BAR schema。历史合同/hash不改写，只应用于后继新构建。
4文件69/69、Worker typecheck/build及2文件Biome通过；无模型调用或库写入。

## 月度分群前的固定合同编码复用

将现有月度/分类共同的observations/source/role/NULL/lineage/元数据编码收敛到纯buildDescriptiveResultContract；原方法选取、来源与权限证明、
执行规则和独立oracle不动。改前clean23dcc9ad先捕获5个合同golden hash并验证，再重构；不是拿改后输出倒填期望。
8文件140/140、Worker typecheck/build与4文件Biome通过。初始tsx -e走CJS不兼容仓库ESM exports，改用node --import tsx --input-type=module完成只读捕获；
未修改运行时或依赖。新增函数的字段map使用明确合同类型修复字面量推断，没有类型绕过。该项无模型/数据库操作，新分群方法继续接续。
