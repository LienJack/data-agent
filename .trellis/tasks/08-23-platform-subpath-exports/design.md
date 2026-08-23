# Platform 子路径出口设计

- 子路径入口只 re-export 真实 owner 模块，不创建 facade service 或复制逻辑。
- workspace architecture scanner 共享 Contracts 根导入门禁实现，以 package-specific baseline 驱动。
- 优先迁移本目标触及的 Q&A、Runtime Config 和 Demo adapter 消费者；历史消费者后续按变更逐步收缩。
- internal transaction、raw pool、private authority 不进入公开子路径。
