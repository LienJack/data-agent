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

- [ ] 两个 repository 实例看到一致模型目录；Map 不再是业务权威。
- [ ] 同一 provider/model 的价格生效区间不重叠，历史行不可更新或删除。
- [ ] 非超级管理员不能变更；超级管理员批准、拒绝与重放均有稳定回执和审计。
- [ ] 七类 provider 价格适配器和 CFETS/PBOC 汇率适配器有冻结 fixture。
- [ ] clean-install PostgreSQL、contracts、platform、worker 和 Web 门禁通过。
