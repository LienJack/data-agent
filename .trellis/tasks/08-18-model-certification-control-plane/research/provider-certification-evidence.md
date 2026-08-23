# Provider API Authentication Evidence

Date: 2026-08-18

## Existing Repository Path

- `apps/web/src/lib/model-discovery.ts` 已提供受限模型目录请求：公开 HTTPS、禁止重定向、10 秒超时、
  2 MiB 响应上限、最多 1000 条，并把供应商错误转换为脱敏稳定错误。
- DeepSeek/Kimi 的 server-only base URL 与 credential alias 已由 system model 配置维护。
- `platform.sync_environment_model_catalog` 已给 exact system profile 分配稳定 ID 与 config version。
- Q&A 只选择 PostgreSQL execution-profile projection 中 `AVAILABLE/selectable=true` 的模型。

## MVP Decision

复用模型目录请求作为凭据可用性认证，不运行模型生成、工具调用、流式或错误行为 Smoke。一次请求返回
有效且非空的模型数组即成功。部署记录保存返回条目数与 exact catalog identity，不保存供应商正文，
也不把该结果描述成模型能力或质量证明。
