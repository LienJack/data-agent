# Runtime Config 设计

- 在 Platform 的明确子路径 `@data-agent/platform/runtime-config` 放置 Node-only 配置加载与别名归一化。
- 输入/输出是显式 `NodeJS.ProcessEnv`，测试不得修改无关全局环境。
- Web 的 once-state 只包装统一 loader；Worker/CLI 直接调用同一 API。
- 公开错误只包含稳定 reason code，不输出变量值。
