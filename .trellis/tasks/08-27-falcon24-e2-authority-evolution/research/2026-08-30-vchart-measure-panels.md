# F6：多指标图表渲染

- 新 canary a26f67a4 / Run `dd8c0adf-16b1-8344-8b42-abe253465b9e` 数据 Oracle PASS；12 行表格、月份/数值、Root 正文与刷新恢复均正确。但截图显示只有一条本期曲线，图例为内部 `line_5`。QA 保持 FAIL，未进入 Trace。
- 本地已安装 VChart Cartesian encoder 对连续轴取 `fields[0]`，`yField: [current, prior, ratio]` 不等于三条 series；旧 mapper 因而遗漏其余度量。三种不同量纲也不能无依据地共用同一纵轴。
- 修复在 Web 纯呈现层按每个 y_key 派生命名分图，分别使用独立纵轴与完整 X 轴/NULL 值，保留同一 sealed dataset；没有新查询、归一化、补零或单位猜测。单 measure/cohort、PIE 与受控非 Cartesian 类型保留现有路径。
- 单图 mapper 对未经拆分的多 measure 失败关闭；图例只由真实 series_key 启用，组件聚合全部实例的 READY/FAILED 并在失败/卸载时释放全部实例。
- 回归先证明 3 个 measure 只产生 1 个 panel，再修复；组件测试验证 3 个命名容器与独立轴说明。scoped commit 后先用历史已完成 Run 做无模型页面诊断，确认真实 Canvas 3 图，再 fresh canary；不能把跨构建诊断拼入正式 PASS。
