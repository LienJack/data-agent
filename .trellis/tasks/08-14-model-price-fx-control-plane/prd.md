# 模型、价格与汇率控制面

## Goal

用 PostgreSQL 替换模型配置 Map，建立 app-global、仅超级管理员可变更的模型目录、官方价格
候选/版本和汇率候选/版本。自动同步只能生成候选；生效版本必须人工批准且历史不可变。

## Requirements

- 模型目录按 `app_id + environment` 隔离，凭证只保存 opaque SecretRef 元数据。
- 非超级管理员的模型、价格、汇率变更在 API、repository 和数据库三层失败关闭。
- 价格支持输入、输出、缓存读写、工具调用和阶梯；未知维度不可计费。
- 官方来源适配器保存受限 raw evidence、内容哈希、解析器版本和异常 diff。
- 同一证据幂等；抓取/解析失败不改变 active version。
- 只有审批事务能创建 immutable price/FX version、关闭旧区间并提升 pricing epoch。
- 无完整价格或外币汇率链的模型保持不可计费。

## Acceptance Criteria

- [x] 两个 repository 实例看到一致模型目录；Map 不再是业务权威。
- [x] 同一 provider/model 的价格生效区间不重叠，历史行不可更新或删除。
- [x] 非超级管理员不能变更；超级管理员批准、拒绝与重放均有稳定回执和审计。
- [x] 七类 provider 价格适配器和 CFETS/PBOC 汇率适配器有冻结 fixture。
- [x] clean-install PostgreSQL、contracts、platform、worker 和 Web 门禁通过。

## 2026-08-15 验收证据

- `postgres-pricing-control.spec.ts` 证明两个独立 repository 读取同一 PostgreSQL 模型目录，
  Web 旧模型 mutation route 已关闭，产品模型读写由数据库 repository 承载。
- 10629 只允许审批函数串行关闭当前区间并创建后一版本，唯一 active version 索引、时间顺序
  检查与 immutable triggers 防止区间重叠和历史更新/删除；PostgreSQL smoke 已复跑通过。
- SQL、Platform 与 Web 测试覆盖非超级管理员拒绝、审批/拒绝、同键重放、operation receipt 与
  append-only audit；`/admin/pricing` 另有服务端直接 URL 角色边界测试。
- Worker `official-source-adapters.spec.ts` 冻结 OpenAI、Anthropic、Gemini、DeepSeek、Grok、
  Kimi、GLM 以及 CFETS/PBOC fixtures，并覆盖未知维度和超限 evidence 失败关闭。
- Contracts、Platform、Worker、Web 定向门、10629 static check 与 clean-install PostgreSQL smoke
  均通过；当前父任务的全仓 lint/typecheck 阻断来自其他未提交 Eval/Semantic 任务，单独记录。
