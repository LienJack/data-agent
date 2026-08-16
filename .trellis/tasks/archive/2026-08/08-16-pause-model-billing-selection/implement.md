# 实施计划

1. 记录并行 dirty baseline，确认当前 billing runtime、model catalog 与 Q&A resource 状态。
2. 先补环境模型同步 contract、Platform、Q&A catalog 和 migration regression tests。
3. 新增向前迁移及 renderer，使 `SHADOW` 下环境模型同步、active catalog、conversation binding 语义一致。
4. 更新 Web 安全投影与“可运行/计费已暂停”文案。
5. 通过权威命令把本地部署切换为 SHADOW，验证 DeepSeek/Kimi 可选择并完成绑定。
6. 运行范围测试、类型检查、Biome、迁移校验和浏览器验收。
7. 显式暂存 owned paths，创建单一范围提交并完成 Trellis 收尾。

## 验证结果

- 权威 billing runtime 已通过 `decide_billing_mode` 从 `ENFORCED / epoch 2` 切到 `SHADOW / epoch 3`。
- 10651/10652 迁移及 checksum renderer 已落库；两个并发 GLM 首次同步事务均成功并回滚，无主键冲突。
- Q&A 资源 API 返回 DeepSeek/Kimi `RUNNABLE + selectable=true`；浏览器创建 DeepSeek 对话后切换到 Kimi，Conversation `resource_version=2`。
- Contracts/Platform/Web 类型检查、范围测试、Web 全包测试、Biome、迁移 verify 与 `pnpm dev:check` 通过。
- Contracts 全包并行测试曾因 15 秒预算出现 7 个超时，失败文件以 30 秒预算单独复跑后 134/134 通过。
- Platform 全包仅剩并行工作树已有的 public surface 清单漂移；本任务范围 pricing 测试 6/6 通过，未修改该并行文件。
