# 通用迁移渲染器设计

- `scripts/lib/migration-renderer.ts` 提供纯渲染/验证 API。
- `scripts/migration-manifests.json` 是声明式单一注册点，同时登记专用 renderer 例外原因和验证命令。
- `scripts/render-migration.ts <id> [--verify]` 是唯一常规 CLI。
- 自定义 renderer 仅用于历史 checksum 特例、旧函数抽取/结构变换或专用安全 manifest，并必须登记例外。
- 验证先建立所有现有 SQL hash 基线，再机械迁移，最终逐文件与 `HEAD` 比较。
