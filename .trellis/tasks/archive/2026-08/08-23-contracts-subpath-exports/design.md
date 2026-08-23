# Contracts 子路径出口设计

- 子路径入口放在 `packages/contracts/src/public/` 或各领域稳定 `index.ts`，package.json 明确 exports。
- 架构扫描复用 `scripts/lib/workspace-architecture.ts` 的 AST import scanner。
- 基线记录“文件 + 根 specifier”，只允许删除，不允许新增；测试代码和生成目录不计入生产基线。
- 后续 Q&A、Runtime、Demo、Platform 任务只使用子路径。
