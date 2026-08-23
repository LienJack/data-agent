# U7 设计

- `packages/semantic/src/application` 持有用例；输入/输出为 U6 strict contract，I/O 为 PortResult。
- Platform adapters 只处理事务、SQL/Neo4j 映射和错误翻译。
- Route 固定：session/workspace capability → strict parse → composition use case → response mapping。
- Web 唯一 composition root 是 Workspace request scoped；Worker 使用 job scoped equivalent。
- 测试 fake 通过参数显式注入，不从生产 env/global singleton 获取。
