# U2 实施

1. Characterize 现有 provider/model 管理与目录行为。
2. 新建 Model Control contract/port/repository 与 focused tests。
3. 切换 Web、Q&A、bootstrap 和 Worker 消费者。
4. 删除 Billing/Pricing 中模型控制符号及 root export。
5. build contracts/platform，运行 Model Provider、model route、secret boundary tests 并提交。

验证：生产调用图对 Pricing/Billing repository 为零依赖。
