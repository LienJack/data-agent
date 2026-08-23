# Model Control 边界

> Model Control 只管理模型供应商连接、SecretRef 元数据、模型目录、能力与技术就绪状态。
> 它不承担价格、汇率、积分、账单或调用成本判断。

## 1. 所有权

- 合同唯一位于 `packages/contracts/src/models/`；禁止从
  `packages/contracts/src/workspaces/billing.ts` 重新导出或复制模型合同。
- PostgreSQL adapter 唯一位于 `packages/platform/src/models/`；禁止把模型目录、供应商连接、
  认证或技术就绪操作放入 `packages/platform/src/pricing/`。
- Web 管理入口通过 `apps/web/src/lib/model-control-admin.ts` 完成 `SUPER_ADMIN` 校验，并从
  `getModelControlRepository()` 获得 repository。
- Q&A 资源解析和 readiness bootstrap 只能读取 Model Control，不得依赖 Pricing/Billing。

## 2. 合同边界

- 允许：provider、model id、display name、base URL、capabilities、SecretRef metadata、
  config version、technical health/readiness、system default。
- 禁止：price、currency、FX、credit、bill、cost、balance、hold、reservation、settlement。
- `credential_ref` 只能是 SecretRef locator 与版本元数据；合同、日志和浏览器响应均不得包含
  credential value、token 或请求 header。
- 管理命令保持 strict schema、`operation_id + idempotency_key`、expected version 与
  app/environment scope；未知字段失败关闭。

## 3. Authority 与权限

- 只有 active `SUPER_ADMIN` 可以修改全局 provider connection 和 model catalog。
- 普通模型目录只返回安全技术投影，不返回 SecretRef locator 或任何商业字段。
- 环境变量托管的系统模型由服务端同步，管理 API 不允许修改、停用或删除。
- Model Control 只证明模型配置与技术就绪；Provider 调用授权仍由独立的 invocation authority
  与 workspace capability 决定。

## 4. 必需验证

- Contract 测试证明 strict schema 拒绝全部商业字段。
- 架构测试证明 Billing 合同、Pricing repository 和 Pricing Admin 不再承载 Model Control。
- Route 测试覆盖 `SUPER_ADMIN`、普通角色拒绝、workspace/environment scope 和系统模型不可变。
- Secret boundary 测试证明浏览器响应、日志和错误中没有明文 credential。
