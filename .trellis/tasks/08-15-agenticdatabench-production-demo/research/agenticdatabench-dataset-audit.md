# AgenticDataBench 数据集与表数量审计

## 固定来源

- Official repository: `https://github.com/AgenticDataBench/AgenticDataBench`
- Audited repository commit: `61bb0d6be3439797d2c75a6ede198b0b296cc226`
- Official dataset: `https://huggingface.co/datasets/shawnzzzh/AgenticDataBench`
- Audited dataset revision: `3b0ac3fde63fd615de92bf70c1dd93b73f92d92f`
- License: Apache-2.0
- Public task file: `testbed/tasks/dev.jsonl`
- Public tasks: 246
- Private test tasks: 98（官方 README 声明暂不公开）
- Official domains: 15

## 口径说明

AgenticDataBench 不是 Falcon 那种“每个 db_id 对应一个关系数据库”的 Text2SQL 数据集。它主要是多文件数据分析工作区，CSV、JSON、Parquet、XLSX、ARFF、GIS 文件和 SQLite 混合存在。

因此下表同时报告：

- `逻辑源/表`：公共任务实际引用、去除路径别名后的唯一输入；一个 tabular 文件按一张 PostgreSQL raw 表估算。
- `单题最多源`：一个公开任务同时处理的最多输入数。
- SQLite 数据库则读取 `sqlite_master` 和 `pragma_table_info`，报告真实表数/列数。

这些数字用于选 Demo，不应直接解释为官方定义的 PostgreSQL schema。

## 15 个领域概览

| 领域 | 公开任务 | 逻辑源/可映射表 | 单题最多源 | PostgreSQL Demo 评价 |
|---|---:|---:|---:|---|
| Agriculture | 22 | 7 | 6 | 多源统计/地理匹配，关系模型一般 |
| E-commerce | 14 | 12 | 10 | 最适合业务 Demo；13/14 题使用至少 4 个源 |
| Energy | 4 | 9 | 9 | 多粒度时间/地理数据，但题量少 |
| Entertainment | 5 | 10 | 8 | 多内容平台，关系不统一 |
| Financial | 24 | 15 张真实关系表/3 个 SQLite 库 | 以库内 SQL 为主 | 生产感强，数据约 89 MB；单库最多 7 表 |
| Healthcare | 24 | 12 个输入；SQLite 展开后约 14 张关系 | 9 | 多模态/高维，数据治理成本较高 |
| Loan Model | 9 | 2 | 2 | 主要展示模型训练，不展示复杂 Schema |
| Loan Risk | 25 | 29 个隔离输入表 | 2 | 任务复杂但每题通常只有 1–2 表 |
| Marketing | 9 | 4 | 1 | 主要展示 Uplift/预测，不适合多表 Demo |
| Real Estate | 25 | 39 | 18 | 文件数量最多，适合多源融合；不是规范化关系库 |
| Social Network | 19 | 7 | 6 | 文本/社媒分析，关系复杂度有限 |
| Sports | 17 | 10 个源；SQLite 展开后共约 16 张关系 | 8 | 数据/SQL 很复杂，但业务叙事偏体育 |
| Strategy | 4 | 3 | 1 | 轻量策略任务，不适合主 Demo |
| Tourism | 22 | 14 | 11 | 多源融合强，XLSX/CSV 混合 |
| Transportation | 23 | 13 | 13 | 复杂度高，但 Parquet/GIS 体量和启动成本高 |

## 真实 SQLite 数据库表数量

| 数据库 | 文件大小 | 表 | 列 | 总体说明 |
|---|---:|---:|---:|---|
| `financial/insurance_business.sqlite` | 62,251,008 B | 7 | 148 | 保险公司、代理人、客户、产品、保单、理赔、代理绩效 |
| `financial/pub_fin_data.sqlite` | 1,556,480 B | 4 | 116 | 公司、资产负债表、现金流量表、利润表 |
| `financial/pub_fund.sqlite` | 25,538,560 B | 4 | 83 | 基金产品、投顾、持仓、行业投资 |
| `healthcare/thrombosis_prediction.sqlite` | 7,327,744 B | 3 | 64 | 患者、检查、实验室 |
| `social_network/Twitter_US_Airline_Sentiment.sqlite` | 5,038,080 B | 1 | 15 | Tweets |
| `sports/European_Soccer_database.sqlite` | 313,090,048 B | 7 | 199 | 国家、联赛、比赛、球员、球员属性、球队、球队属性 |

### Financial 逐库明细

- `insurance_business`: 7 表，168,357 行；其中保单 50,000、理赔 39,868、代理绩效 39,154、客户 35,000。
- `pub_fin_data`: 4 表，4,863 行；14 个公开任务。
- `pub_fund`: 4 表，179,114 行；8 个公开任务，CTE/子查询/窗口类任务较多。
- 三库合计 15 张真实表、24 个公开任务，适合金融专题 Demo，但单一业务库仍只有 7 张表。

## E-commerce 详细审计

### 原始数据源

AgenticDataBench E-commerce 共 12 个逻辑数据源：

1. Olist customers
2. Olist geolocation
3. Olist order items
4. Olist payments
5. Olist reviews
6. Olist orders
7. Olist products
8. Olist sellers
9. Product category translation
10. Amazon Cell Phones reviews JSON
11. Amazon Cell Phones metadata JSON
12. eBay laptops CSV

Olist 9 个 CSV 合计 126,186,995 bytes。其结构包含 52 个源字段，主要规模为：geolocation 约 100 万行、orders/customers 各约 9.9 万行、order items 约 11.3 万行、payments 约 10.4 万行。

完整 E-commerce 文件体量：

| 部分 | Bytes |
|---|---:|
| Olist 9 CSV | 126,186,995 |
| Amazon reviews JSON | 141,690,237 |
| Amazon metadata JSON | 2,826,667,616 |
| eBay CSV | 4,145,925 |
| 合计 | 3,098,690,773 |

完整 3.10 GB 数据不适合随面试项目仓库自动导入。尤其 2.83 GB Amazon metadata 会显著增加 clone、迁移和 CI 成本。

### 公开任务复杂度

- E-commerce 公开任务：14。
- 全部 14 题都是多源任务。
- 13/14 题同时使用至少 4 个源。
- 单题最多使用 10 个源，平均 7.21 个。
- 只有 `ecommerce_35` 完全基于 Olist，使用 8 张表。
- `ecommerce_15`、`ecommerce_16` 明确要求 Amazon 两个 JSON 只读取前 10,000 条，并同时关联 eBay 与 Olist，适合做固定有界 slice。
- 其他多数电商题要求完整 Amazon 数据，不能在 bounded slice 上冒充官方兼容成绩。

## 与 Falcon 的直接比较

| 维度 | Falcon | AgenticDataBench E-commerce |
|---|---|---|
| 主任务形态 | NL2SQL/结果匹配 | 多文件数据分析、清洗、匹配、统计、建模、可视化、产物生成 |
| 单库最大表数 | DEV 候选最大 9 表 | 12 个逻辑源；Olist 9 张关系表 |
| 单题输入跨度 | 多为单个 db_id 内 SQL | 最多 10 个数据源，13/14 题使用至少 4 个源 |
| 官方数据体量 | 固定快照约 310.57 MB 解压 | E-commerce 完整约 3.10 GB |
| 下载即见适配 | 容易 | 必须使用 Olist + 固定 Amazon slice，不能全量内置 |
| 面试生产展示 | Text2SQL/Oracle 强 | 数据接入、质量、建模、SQL+Python、产物、评测与可观测性更强 |

## 建议

推荐把 AgenticDataBench E-commerce 作为主面试 Demo，但采用明确标注的 `PostgreSQL Demo v1` 衍生套件：

- 固定导入 Olist 9 表、完整 eBay 1 表、Amazon reviews/meta 各前 10,000 条，共 12 张 raw 表。
- 基于 raw 层建立生产型 dimensions/facts，而不是用重复表名虚增数量。
- 官方兼容范围只包括 `ecommerce_15`、`ecommerce_16`、`ecommerce_35`；其他题标为项目自建 Production Suite。
- Falcon 保留为 Text2SQL 对照或后续可选适配器，不再作为主面试叙事。

该选择的价值不是单纯从 9 表增加到 12 表，而是把系统展示从“生成 SQL”提升为“多源数据 Agent 的生产闭环”。
