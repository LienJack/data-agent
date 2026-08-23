# U6 实施

1. 建立 contract inventory 和 V1 consumer scan，先写 V2 target/forbidden tests。
2. 定义 V2 runtime content/envelopes/hash/invariants 和 Semantic Ports/subpath exports。
3. 改写 Graph compiler、U5 compiler、formula/contribution/relationship/auth lowerers、Analysis Context。
4. 切换所有消费者后删除 V1/legacy contracts、fixtures、tests 和 exports。
5. 实现/render `10701` 与 catalog assertions，运行 contracts/semantic tests 和 PG smoke。
6. 完整 V2 journey/Authority/RBAC 审计后提交 scoped commit。
