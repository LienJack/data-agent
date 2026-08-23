# Falcon 上游快照审计

## 审计结论

本阶段一次性导入固定 Falcon 快照的全部 28 个 SQLite 数据库，并将 `db_id=14` 的玩具零售域作为默认客户 Demo。固定快照包含 500 道题：DEV 309 题/16 库，TEST 191 题/12 库；其中 `db_id=14` 有 32 道中文问题和 4 张业务表。

本项目不实现 Falcon 自动更新、定时同步或上游漂移兼容。固定快照的来源、文件摘要和导入回执只用于初次导入验证、审计和可重复重建。

## 固定来源

- Repository: `https://github.com/eosphoros-ai/Falcon`
- Commit: `8ff29caaa7fad5c7b8f8864f2fc19f9f698d39a5`
- Project license: Apache-2.0
- Legal notice: 仓库 `LEGAL.md`
- Fixed snapshot: 500 questions / 28 databases
- DEV: 309 questions / 16 databases
- TEST: 191 questions / 12 databases
- Default Demo slice: `db_id=14`, 32 DEV questions

## 固定快照体量

- 固定 commit 的 GitHub zip 为 112,044,489 bytes；本次审计 SHA-256 为 `4319ee318beb1433728989544381def70259abfa8ee49b73e52130c1f1d27b1d`。
- 解压后的仓库文件合计约 310.57 MB。
- 28 个 SQLite 文件合计 132,804,608 bytes。
- 95 个 CSV 文件合计 174,827,471 bytes。
- 导入 PostgreSQL 后的真实体量必须以 `pg_total_relation_size` 回执为准；规划阶段预估业务表、约束和索引合计低于 1 GB，并计入现有 `pgdata` 的容量验收，不新增数据卷。

## 已审计关键文件

| Relative path | Bytes | SHA-256 |
|---|---:|---|
| `LICENSE` | 11,379 | `ead5038abadd0e0a158cb11a084002da5f88621c54261d2a9964ca36a4d9b42c` |
| `LEGAL.md` | 572 | `adba50d9794b9ef3f7ec8cbc680f7f1fa3fbf9df0ac8d1f9b9ccab6d941bc11b` |
| `dev_data/dev.json` | 2,527,064 | `673a0d7a014139bcfbec3b65f582066ec4d5bd2ba6e913377990edea5ab21c8b` |
| `dev_data/tables.json` | 174,031 | `9d76594b6aaf2305f6d6fe98e3d2ed302d1674f3f677276f0524a98d64d2ac77` |
| `dev_data/dev_databases/14/14.sqlite` | 20,480 | `cab0d0d410aea015a931a23aae56e054ca1b8fd3532ecc40c569134dc6ca0fec` |
| `dev_data/dev_databases/14/database_description/toy_inventory.csv` | 195 | `ee158ca92e92422dcdc4aba5e21bc26c7813fd3f91e7ef4ecee7bfd11123fadc` |
| `dev_data/dev_databases/14/database_description/toy_products.csv` | 897 | `3f5fa0080f679d83e811d79eecc3c3ea1b0edbdd44cd81359ad479f428aae004` |
| `dev_data/dev_databases/14/database_description/toy_sales.csv` | 544 | `40aecb4ffd6cc0035ee9ffa4a467e988833837ed1834daf2ae162a88146137b9` |
| `dev_data/dev_databases/14/database_description/toy_stores.csv` | 1,199 | `609ffd8422d908ff2ea5ff1092c0deb64d381b722055bd0564092d1036ffc4ce` |

这些 hash 只对上述 commit 有效。实施前由固定本地快照生成覆盖 28 个 SQLite 和 95 个 CSV 的完整 content manifest；本表保留题库入口与默认 db14 Demo 的已核验锚点。实现只在初次导入和显式重建时校验，不提供自动重新下载或升级逻辑。

## 数据结构

### `toy_products`

- `Product_ID` integer
- `Product_Name` text
- `Product_Category` text
- `Product_Cost` text，例如含 `$` 和尾随空格
- `Product_Price` text

### `toy_sales`

- `Sale_ID` integer
- `Date` text
- `Store_ID` integer
- `Product_ID` integer
- `Units` integer

### `toy_stores`

- `Store_ID` integer
- `Store_Name` text
- `Store_City` text
- `Store_Location` text
- `Store_Open_Date` text

### `toy_inventory`

- `Store_ID` integer
- `Product_ID` integer
- `Stock_On_Hand` integer

## Case 格式与方言风险

上游 dev case 包含：

- `question_id`
- `db_id`
- `question`
- `SQL` 数组
- `answer` 数组
- `is_order`

Gold SQL 面向 Falcon 的 MaxCompute/Hive 语义和 SQLite 执行数据，可能含反引号、SQLite 函数、注释和多个替代表达。它不能无校验地作为 PostgreSQL Gold SQL。衍生套件应以固定 `answer` 形成 server-only expected result；上游 SQLite + Gold SQL 只用于初次导入 parity/诊断。

## 知识数据风险

`database_description/*.csv` 在该库中主要是样例数据行，不是可靠的业务定义文档。实现不能把文件名中的 `database_description` 当作语义权威。业务知识必须由 schema、题目中明确的业务概念和人工可审阅口径形成，并注明假设。

## 合规边界

- 保留上游 LICENSE、LEGAL 和 commit/hash 来源。
- UI 和 runbook 标注衍生套件，不混淆官方 Falcon 成绩。
- 不把 sealed Gold/answer 暴露给模型或普通客户 API。
- 本任务不跟踪上游变化；若未来另立升级任务，必须生成新的审计和 receipt，不能覆盖本次固定快照。
