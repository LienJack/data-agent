# 官方模型价格、汇率与身份能力调研

## 结论

模型价格同步不能假设所有供应商都提供稳定 JSON API。首期采用供应商独立的
`PriceSourceAdapter`：只读取官方来源，保存原始证据、内容哈希和解析器版本，标准化为
待审核候选；只有超级管理员确认后才生成生效价格版本。任何抓取、解析或字段完整性失败
都保留上一个生效版本并告警，不允许以零价格或部分字段继续。

汇率采用相同的“官方来源 -> 候选 -> 人工确认 -> 生效版本”流程。结算永久绑定原币
价格版本和汇率版本，历史账单不因后续同步变化而重算。

身份认证优先采用成熟认证组件承担密码散列、Cookie 会话、会话撤销和账号封禁；
Data Agent 自己维护全局 `SUPER_ADMIN` 与工作空间成员权限，避免认证库角色成为业务
授权的唯一权威。

## 模型价格来源矩阵

| Provider | 官方来源 | 自动化形态 | 设计处理 |
| --- | --- | --- | --- |
| OpenAI | <https://openai.com/api/pricing/> | 官方 HTML 定价页 | 专用解析器；保留页面证据和解析器版本；字段不完整时拒绝候选 |
| Anthropic | <https://platform.claude.com/docs/en/about-claude/pricing> | 官方文档，包含输入、输出、缓存、批处理等维度 | 以价格维度表标准化，不把输入/输出两列当成完整价格模型 |
| Google Gemini | <https://ai.google.dev/gemini-api/docs/pricing> | 官方文档，存在 token 阈值、缓存和工具费用 | 支持阶梯与附加维度；不支持的维度使模型保持不可计费 |
| DeepSeek | <https://api-docs.deepseek.com/quick_start/pricing> | 官方文档，包含缓存命中/未命中及输出价格 | 结合实际 usage 字段结算；价格变化只生成新候选 |
| xAI | <https://docs.x.ai/developers/rest-api-reference/inference/models> | `/v1/models`、`/v1/language-models` 返回结构化价格 | 优先结构化同步；仍保存响应哈希和标准化快照 |
| xAI 调用成本 | <https://docs.x.ai/developers/cost-tracking> | 响应可提供 `cost_in_usd_ticks` 精确成本 | 保存供应商实际成本作对账事实，不替代本地价格版本和积分账本 |
| Moonshot/Kimi | <https://platform.kimi.com/docs/pricing/chat-v1> | 官方平台文档 | 专用解析器；无法稳定解析时转为管理员手工录入官方证据 |
| 智谱 GLM | <https://docs.bigmodel.cn/cn/faq/fee-issues> | 官方文档入口指向产品定价 | 专用适配器或手工候选；必须记录最终官方证据 URL |

以上价格会变化，规划文档不固化任何具体单价。实现时以同步得到且经审核的不可变版本
作为唯一计费输入。

## 汇率来源

- 中国外汇交易中心人民币汇率中间价：
  <https://www.chinamoney.com.cn/chinese/bkccpr/index.html?tab=2>
- 中国人民银行人民币汇率中间价公告索引：
  <https://www.pbc.gov.cn/zhengcehuobisi/125207/125217/125925/17105-2.html>

首期以中国外汇交易中心或人民银行官方发布为权威候选来源。同步结果至少包含币种对、
汇率值、官方发布日期、抓取时间、来源 URL、原始证据哈希、解析器版本和审核信息。
周末、节假日或同步失败时继续使用最近一个已确认且处于生效期的版本；没有可用版本的
外币模型必须禁止面向普通用户调用。

## 身份认证组件

Better Auth 官方文档显示其支持 PostgreSQL、email/password、传统 Cookie 会话、管理员
创建/封禁用户以及撤销单个或全部用户会话：

- PostgreSQL：<https://better-auth.com/docs/adapters/postgresql>
- Admin plugin：<https://better-auth.com/docs/plugins/admin>
- Session management：<https://better-auth.com/docs/concepts/session-management>

建议把它作为实现阶段的首选认证适配器，但保持以下边界：

1. 关闭公开注册，只允许服务端超级管理员流程创建账号。
2. 认证库只负责身份、凭证与会话；`workspace_memberships` 和业务权限由 Data Agent
   PostgreSQL Authority 在事务内重新验证。
3. 停用用户时，在同一业务操作中更新用户状态、提升权限 epoch，并撤销全部会话；
   外部副作用失败必须留下可恢复的 operation receipt，不能假装已经完成。
4. 禁用管理员模拟登录能力，首期不提供 impersonation。
5. 认证库 schema 变更必须生成并审查 SQL 迁移，不在生产启动时自动改表。

最终依赖版本在实施开始时锁定并做兼容性验证；本调研不把当前文档版本当作永久接口。
