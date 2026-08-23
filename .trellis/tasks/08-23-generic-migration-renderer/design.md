# 通用迁移渲染器设计

- `scripts/lib/migration-renderer.ts` 提供纯渲染/验证 API。
- `scripts/migration-manifests.ts` 是声明式单一注册点。
- `scripts/render-migration.ts <id> [--verify]` 是唯一常规 CLI。
- 自定义 renderer 只能通过显式 `customTransform/customValidation` 注册或保留少量有说明的例外脚本。
- 验证先建立所有现有 SQL hash 基线，再机械迁移，最终逐文件与 `HEAD` 比较。
