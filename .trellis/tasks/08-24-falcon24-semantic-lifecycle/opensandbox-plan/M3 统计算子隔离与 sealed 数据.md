# M3 统计算子隔离与 sealed 数据

## 目标

把 BH-FDR、Theil-Sen、Mann-Kendall、HAC、Shapley 和分群留存固化为唯一、版本化、可证明的 `data_agent_stats` 算子包，并通过独立 operator context 消费 sealed 数据。

## 实现步骤

1. 从旧 runtime 包中拆出纯算子包与 manifest；每个算子固定 id/version、schema、前置条件、缺失值规则、随机性、输出和误用边界。
2. 构建固定依赖镜像并生成 lock/SBOM/attestation；运行期禁止安装和修改算子代码。
3. Agent 只提交 operator id、参数与 input artifact hash；宿主校验合同后在 operator context 执行固定 dispatcher。
4. operator 输出写 sealed Parquet/JSON，生成 receipt：实现 digest、输入/输出 hash、参数、warnings、耗时和资源。
5. 用黄金样本、边界样本和独立实现交叉验证六类算子。

## 代码分析

### 结构与职责

- `data_agent_stats` 是统计语义唯一来源；DeepSeek 只编排。
- operator dispatcher 是固定代码，不接受任意源码、模块名、shell 或文件路径。
- host 负责 schema/hash/权限校验；operator context 不读取 Agent 工作目录中的源码。

### 关键实现

BH-FDR 固定排序、单调校正和 NaN 规则；Theil-Sen 固定配对斜率、置信区间和重复 x 处理；Mann-Kendall 固定 ties/variance/continuity correction；HAC 固定 lag/kernel/small-sample 口径；Shapley 固定价值函数、精确/近似阈值、seed 和误差；分群留存固定 cohort/age/eligible denominator、零订单、完整观察窗与异常关系处理。

算子只能读 `/inputs/<hash>.*` 和自身只读包，写 `/outputs/operator/<call-id>/`。任何 hash/schema 不符立即拒绝，不做宽松列名猜测。

### 风险与坑点

- SciPy/statsmodels 版本升级会改变边界输出；版本和 golden fixture 必须一起升级。
- Shapley 近似若无固定 seed/误差界不是可重复算子。
- 留存最易因未来观察窗不足、注册后关系异常和分母漂移产生“正确计算、错误口径”。
- 仅靠 Python import 约束无法隔离 Agent；必须使用独立 context/文件权限和固定 dispatcher。

## 验收标准

- 六个 operator contract、黄金测试、性质测试和 misuse 测试全部通过。
- 搜索不存在第二套生产公式、旧函数或 fallback；Agent 源码中出现重实现时被策略拒绝。
- 每次调用都有完整 receipt，重放输出 hash 稳定；近似算子声明 seed 与误差。
- Agent context 无法读取算子源码或写入 operator 目录。

## 备注

如某题需要尚未治理的新统计方法，应先新增候选算子、验证并发布版本；不能让 DeepSeek 临时把它伪装成已有算子。

