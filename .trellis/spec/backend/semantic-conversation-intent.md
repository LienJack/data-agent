# 多轮语义检索意图

## 适用范围

Root 多轮问答、Semantic Context Request/Snapshot/Receipt、检索候选容量与 PostgreSQL `10816`。
历史用户问题只帮助寻找本轮所需对象，不是数据、公式权威或上一轮 Artifact 的接受回执。

## 唯一链路

1. Worker 在语义解析前通过原 `ProviderTaskArtifactAuthority.commit` 冻结本 Run 的 v2 Task；
   检查原 V3 Root lease、visible message refs（含摘要覆盖引用）与 current Run。失败时不解析语义、不调用模型。
   Root dispatch 随后复用同一 Task 的幂等回执，不能另选历史。
2. RUN request 的可选 `basis.provider_task_ref` 绑定 exact scope/run/revision/hash；PREVIEW 不接受该字段。
   历史 request 无此字段时保留原 hash 与行为。
3. `10816` 复用原 `load_provider_task_artifact`；u12 owner 仅新增该窄 reader 的 EXECUTE，
   不授予 Artifact 表 SELECT。reader 保留 scope/principal/hash/active 检查；语义 loader 再比较
   current question、conversation ID/resource version 与已验 config。原 lease/fence/current release 检查不改。
4. Snapshot `conversation_intent` 含 task ref、context selection hash、最近最多8条可见的历史 user/text
   问题（message_id/content，按原顺序）。排除当前消息、assistant、表格与历史摘要正文；不读取旧分析结果。
   历史超过该窗口的指代不能靠扩大权限或继承旧结论解决，须通过当前问题补充/澄清。
5. 当前问题/hash/route/clarification 不改。历史用户问题与当前问题一起用于同一发布范围内的词法、稀疏、向量检索；
   历史 exact lexical 对象重新构造本轮依赖闭包。维持 excluded-object 硬过滤，不复制上一轮 selected objects。
6. 默认 optional recall 为每个 distinct normalized question 12个候选；显式 max_optional_nodes 仍优先。
   总节点≤80、边≤160、hop≤3 不变，mandatory 超容量仍失败关闭。不能把单句12个的配额误当整个多轮上下文配额。
7. Receipt `query_hash` 始终是当前问题；含历史意图时另保存 `intent_context_hash` 与
   `retrieval_query_hash`（按原顺序用换行连接历史问题和当前问题）。Snapshot/package identity 包含来源。
   commit RPC 独立重载 Snapshot 并以 `IS DISTINCT FROM` 重算两项 hash；缺失、换绑或额外伪造不能接受。
8. Semantic Specialist dispatch 也复用原幂等 Task authority，验证 V3 Root lease、Run/scope/ref hash、
   Conversation ID/resource version、当前问题及 visible refs。只把与第4项相同的历史用户意图投影放入
   user 消息；来源 task ref/context selection hash 和正文一起进入 Specialist request task hash。
   不得把 Root Task ref 冒充 Specialist 派生请求的 identity；Root 请求仍保留原 Task ref。
   模型须从有界历史补全追问的指标、比较方式和完整周期窗口，当前明确纠正优先，无法消歧则返回 ambiguity。
   这不是确定性语义选择：真实 Run 仍须验证接受的 request operations 是否包含继承窗口和比较口径。
9. 当前受支持的结果同比路径同时需要 PERIOD_COMPARISON_RATE 和可解析的完整周期窗口。
   Worker 投影 DATA_RESULT_REQUIRED 且无 ambiguity 的上下文时，若包含同比操作但
   `resolveSemanticRequestTimeWindow` 返回 null，须在 Artifact commit 前拒绝
   `TEAM_SEMANTIC_COMPARISON_WINDOW_REQUIRED`。Semantic 从同一有界用户意图补齐窗口，
   没有可支持的时长则声明 TIME_DOMAIN ambiguity；Root 在原预算内反馈 Semantic，不能重复提交 Text2SQL。
   不增重试预算、不默认12月、不复制旧 Run 操作；SEMANTIC_FACTS_ONLY 定义查询不要求数据窗口。

## 禁止

- 把 assistant 文本、摘要或旧 QueryEvidence 数值作为新 Run 的事实。
- 把整个 catalog 直接交给 Specialist、跳过 `TEAM_SEMANTIC_SELECTION_OUTSIDE_FROZEN_CLOSURE`。
- 为失败题补写成功回执、跨 build 拼接、改写当前问题或旧 snapshot/hash。
- 让旧历史的 route 取代当前明确纠正的口径；候选被召回不代表模型已选择或业务验证成功。

## 验证

- Contracts/Platform：旧 hash兼容、current question保留、Task跨 scope/run 拒绝、snapshot来源省略/替换/Preview混入拒绝、正文/hash篡改。
- Worker：先 Task 后 Semantic、非Root原路径、Task失败和 visible history不匹配时零 Semantic/Provider。
- Specialist：真实 dispatch 捕获窗口/同比上下文、最后8条边界、旧答案排除、首问空历史、当前纠正末位；
  lease/Run/scope/hash/Conversation/version/current-question/history漂移与Task失败时零模型调用。
- Semantic：多轮弱匹配月份召回、显式与总容量、去重、excluded对象、依赖闭包；不得用测试题字符串分支。
- Semantic projection：缺失同比窗口时零 Artifact commit/零 Text2SQL；完整窗口、纯定义和已声明歧义保持原契约。
- PostgreSQL：clean install、populated clone升级和347张业务表hash不变、只投影最后8条user/text、原安全边界和reader窄grant。
- 真实复杂 Run 仍需新clean build/scratch后的业务及同Run UI/Trace证明；离线历史重编译不是验收PASS。
