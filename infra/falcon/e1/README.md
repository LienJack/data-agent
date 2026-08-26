# Falcon24 Authority Epoch E1 retained assets

本目录只保存 E1 允许继承的定义性、无敏感资产投影。它不是运行时状态备份，也不能用于恢复
旧 Release、Profile、Receipt、Run、Artifact、Trace、Qualification 或 Campaign identity。

`llm-provider-model-profile.json` 只包含逻辑 Provider/Model/Profile 配置。API key、SecretRef
identity、健康状态、认证回执、actor、时间戳和环境 UUID 均禁止进入该文件。

`retained-assets-manifest.json` 由 `scripts/build-falcon24-e1-baseline.ts` 从固定 Git 资产重建；
不得手工修改 hash。生成前应先运行只读导出：

```bash
pnpm exec tsx scripts/export-falcon24-retained-assets.ts --output .data/falcon24-e1-retained-export.json
pnpm exec tsx scripts/build-falcon24-e1-baseline.ts \
  --export .data/falcon24-e1-retained-export.json \
  --output infra/falcon/e1/retained-assets-manifest.json
pnpm exec tsx scripts/verify-falcon24-retained-assets.ts
```

导出或 canonical semantic diff 为 HOLD 时，builder 必须停止，不能进入 E1 PostgreSQL authority
或 bootstrap。当前数据库不存在待保留的安全 LLM profile 时，导出显式记录 `RECREATE`，U3 必须
从本目录 manifest 创建全新 identity 并重新绑定 SecretRef；数据库存在同 logical key 但内容不一致时
仍然是 HOLD。包含最终 code commit、Web build 和 staging receipts 的 runtime baseline 只能在实现冻结
后的 final clean environment 中构造并写入 PostgreSQL，不提交到 Git。
