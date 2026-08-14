# 模型、价格与汇率控制面设计

## Authority

Cookie session 解析 `SessionPrincipal`；全局管理请求必须在数据库事务内重验 app user 仍为
`ACTIVE SUPER_ADMIN`、authz epoch 与 deployment/app lifecycle。客户端 role 无效。

## Data model

- `model_catalog_entries` / `model_config_versions`：全局模型身份、能力、endpoint、
  SecretRef identity/version 和可用状态。
- `model_price_candidates` / `model_price_candidate_components`：同步证据、hash、diff、风险与
  待审标准化价格。
- `model_price_versions` / `model_price_components`：批准后不可变的生效价格和维度。
- `fx_rate_candidates` / `fx_rate_versions`：官方日期、币种对、证据与生效区间。
- `pricing_sync_operations`：幂等同步结果、失败原因和 raw evidence（64 KiB 上限）。
- `pricing_control_state`：app/environment 的 pricing epoch。

候选同步按 evidence hash 幂等。批准函数在一个事务内锁定候选和控制状态、关闭上一 active
区间、创建版本、更新候选、提升 epoch 并写 audit。已批准版本和 component 由 trigger 拒绝
UPDATE/DELETE。

## Adapters and worker

各 provider/FX adapter 只解析 strict、版本化官方证据；HTTP fetcher 独立注入并限定大小、
超时和来源 URL。解析失败只记录失败 operation。Worker 提供可定时调用的单周期同步器；
没有配置真实抓取器时保持 fail-closed。

## Web

全局 `/api/admin/models|prices|fx/**` 先做 super-admin request guard，再调用 repository。
旧 `/api/models` mutation 返回全局管理员路由要求；设置页使用服务端 DTO，不传明文 API key。
