# b4a237db Semantic canonical schema instruction 复盘

## 新构建与数据边界

- commit `b4a237db85a633598747c4dba1fe216eff2fd7ac` force build 8/8、0 cache，full unit 15/15，build attestation PASS。
- fresh physical scratch `data-agent-falcon24-e17-b4a237db` / 55509 经 `pg_verifybackup`、10816 migration assertions、347业务表
  指纹、9表70列121445行数据集三 hash 校验；一次 certification PASS并仅在 scratch 激活 E17。live 保持 E16。
- Web/Worker generation `sha256:7391fe3cde58812a8369ef408bff4f9888f9b86a63fad29baa992c7e52e4ac5e` 同源。

## 不可变首败

A1 Run `cf11f7e9-6bdd-81f3-b93c-f3b6c70d3040` 只提交一次。四个 Semantic logical call 都不再空白，而是完整 JSON 到达
原 `semantic-query-selection-intent@1.0.0` 后以 `RESPONSE_SCHEMA_MISMATCH` 失败；Root budget耗尽，Run FAILED，零
SemanticQueryContext、SqlArtifact、QueryEvidence、AnalysisReport或Chart。没有重提该 Run，也没有继续 A2-B3。

这证明第一次修复解决了 DeepSeek Structured Output 的空白 transport，但 `response_format=json_object` 只约束 JSON 语法。
JSON_TEXT 路径没有像 Mastra Structured Output 那样向模型提供 exact nested schema，模型只能从自然语言系统提示猜嵌套类型。

## 前向闭包

registry 继续由服务端 exact Zod schema生成并冻结 canonical JSON Schema。只有 `delivery_mode=JSON_TEXT` 时，bridge把该 exact字节串
连同禁止增删、改名、强制转换和修补的指令加入 server-owned system instructions；原业务 system instruction保留。Trusted input
upper bound观察完整 execution instructions并继续计入 canonical schema bytes，保持保守上界。

传输、调用次数和验证不变：一次原 SDK `json_object`、零 tools、完整原文 `JSON.parse`、同一 strict Zod schema、canonicalize。
不增加默认值、coercion、JSON提取、retry或 Host业务路由。离线 wire test只证明合同；必须再做新 clean build/fresh scratch，从A1
开始六题全部重跑，才能证明真实 Semantic -> Text2SQL -> Analysis协作。

## 本地验证与清理

Agent Runtime unit 193、integration 46、security 67、contract 32、focused 51 tests，Worker official unit 101与受影响 focused 116 tests
全部PASS；两个 package typecheck/build、owned Biome、diff与Trellis validate PASS。live before/after 348表指纹完全一致；本构建Web/Worker、
两个browser和auth已精确关闭，55509转发取消，scratch容器停机且volume作为不可变失败checkpoint保留。
