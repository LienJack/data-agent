# 执行计划

1. 全文搜索 `v1/v2`、`兼容`、`双读`、`回退`、`migration` 等策略表述。
2. 将 M1 contract/database/platform 设计改为唯一当前 schema/RPC，仓库内消费者原子切换。
3. 将测试、发布和回滚改为 current-only 验收；保留 projection failure 的同版本 typed fallback。
4. 更新完成定义和大纲启动条件，检查 Markdown 链接与 diff。
