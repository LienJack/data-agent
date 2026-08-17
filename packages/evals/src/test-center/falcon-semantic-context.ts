import type { PublicBenchmarkCase } from "@data-agent/contracts";

const FALCON_DB04_ONTOLOGY_CONTEXT = [
  "Falcon db04 公开语义本体：",
  "finance_factoring_data 的 Disputed 公开枚举仅为 'Yes' 与 'No'；中文‘存在争议’必须映射为 Disputed='Yes'。",
  "题目直接要求筛选发票而未限制投影时，发票指完整业务投影，顺序为 countryCode、customerID、DaysLate、DaysToSettle、Disputed、DueDate、InvoiceAmount、InvoiceDate、invoiceNumber、PaperlessBill、PaperlessDate、SettledDate；按 InvoiceAmount DESC 排序后取 LIMIT。",
  "大小写字段必须精确双引号引用，尤其是 InvoiceAmount、Disputed、customerID 与 invoiceNumber。",
].join("\n");

const FALCON_DB15_ONTOLOGY_CONTEXT = [
  "Falcon db15 公开语义本体：",
  "交易通过 Credit_Card_ID→credit_card_card_base.Card_Number，再由 card.Cust_ID→customer.Cust_ID 关联客户。Customer_Segment 来自 customer 表。",
  "Fraud_Flag=1 表示欺诈，Fraud_Flag=0 表示非欺诈；‘排除非欺诈交易’必须保留 Fraud_Flag=1。",
  "每个客户的首次交易用 ROW_NUMBER() OVER (PARTITION BY Cust_ID ORDER BY Transaction_Date, Transaction_ID) 后筛 rn=1。",
  "Transaction_Date 是 DD-Mon-YY 文本，时间排序必须先用 to_date(Transaction_Date, 'DD-Mon-YY') 解析，不能按原始字符串排序。",
  "若题目要求客户、客户等级及交易金额，输出 Cust_ID、Customer_Segment、Transaction_Value，不额外输出交易日期或交易 ID。",
].join("\n");

const FALCON_DB17_ONTOLOGY_CONTEXT = [
  "Falcon db17 公开语义本体：",
  "电子产品在公开快照中的精确枚举是 product_category_name='electronics'。",
  "卖家销售额与运费比例=SUM(order_items.price)/NULLIF(SUM(order_items.shipping_charges),0)，按 seller_id 聚合；问题明确提到该比例时输出最高比例对应 seller_id 与 ratio。",
].join("\n");

const FALCON_DB18_ONTOLOGY_CONTEXT = [
  "Falcon db18 公开语义本体：",
  "旅游、腐败和失业表通过 country 连接；题目要求国家及对应指标时输出 country、corruption_index、unemployment_rate。",
  "百分比阈值先转为比例：5%=0.05；5 亿美元=0.5 billion。因此相应过滤使用 percentage_of_gdp>0.05 与 receipts_in_billions>0.5。",
].join("\n");

const FALCON_DB28_ONTOLOGY_CONTEXT = [
  "Falcon db28 公开语义本体：",
  "订单通过 order_id 连接发货，通过 customer_id 归属客户。订单金额是 orders.total_price，承运商是 shipments.carrier。",
  "先按 carrier 与订单金额过滤，再按 customer_id 对 shipment_date DESC 排名并选 rn=1；‘等待天数’是同一条发货记录的 delivery_date::date-shipment_date::date，输出整数天。禁止用来自不同记录的独立 MIN/MAX 混算。",
  "客户级问题每个 customer_id 只返回一行。",
].join("\n");

export const FALCON_DB14_ONTOLOGY_CONTEXT = [
  "Falcon db14 公开语义本体：",
  "业务主体：商品(toy_products)、门店(toy_stores)、销售(toy_sales)、库存快照(toy_inventory)。",
  "关系：销售通过 Product_ID 指向商品、通过 Store_ID 指向门店；库存通过 Product_ID 指向商品、通过 Store_ID 指向门店。",
  "维度：商品类目 Product_Category、门店位置 Store_Location、销售日期 Date。",
  "指标：库存量=SUM(Stock_On_Hand)；销量=SUM(Units)；销售额=SUM(Units * Product_Price)。",
  "口径：库存是门店-商品粒度的快照；跨门店汇总时先按 Product_ID 聚合，再关联商品名称。",
  "PostgreSQL 标识符：db14 的字段名保留大写，所有 Product_ID、Product_Name、Product_Category、Product_Cost、Product_Price、Store_ID、Store_Name、Store_City、Store_Location、Store_Open_Date、Sale_ID、Date、Units、Stock_On_Hand 都必须用双引号精确引用。表名保持小写。",
  "货币清洗：Product_Cost 与 Product_Price 是含 '$' 和空格的文本；数值计算使用 NULLIF(regexp_replace(字段,'[^0-9.-]','','g'),'')::numeric。不能直接 CAST 原文本。",
  "门店枚举：中文商业区/商业区域精确映射 Store_Location='Commercial'；另有 'Downtown' 与 'Residential'。Date 是 YYYY-MM-DD 文本，可按 LIKE '2018%' 或转 date。",
].join("\n");

export const FALCON_DB24_ONTOLOGY_CONTEXT = [
  "Falcon db24 Blinkit 公开语义本体：",
  "业务主体：客户、订单、订单明细、商品、客户反馈、配送履约、库存快照、营销活动。",
  "主体标识：客户由 customer_id 稳定标识；题目问‘哪些客户’且未明确要求姓名时，输出 customer_id，不额外输出客户名称、分群或中间指标。",
  "主体关系：订单.customer_id→客户.customer_id；订单明细.order_id→订单.order_id；订单明细.product_id→商品.product_id；客户反馈.order_id/customer_id→订单/客户；配送履约.order_id→订单；库存.product_id→商品。",
  "维度：客户分群 customer_segment、订单日期 order_date、配送状态 delivery_status、支付方式 payment_method、商品类目 category、品牌 brand、反馈类别 feedback_category、情感 sentiment、营销渠道 channel。",
  "支付枚举：中文‘现金’精确映射 payment_method='Cash'；其他公开值为 'Card'、'UPI'、'Wallet'，不得把中文标签直接作为物理值。现金品牌销量占比是 0-1 小数，必须用 SUM(quantity)::numeric / NULLIF(total_quantity::numeric,0) 避免 PostgreSQL 整数除法；输出 brand 与 sales_ratio，不乘 100、不 ROUND、不输出 total_quantity。",
  "Falcon 现金销量兼容口径：先对 Cash 订单明细按 product_id+brand 计算 occurrence_count=COUNT(*) 与 quantity_sum=SUM(quantity)，再以 occurrence_count*quantity_sum 作为该商品销量贡献，按 brand 汇总后除以全部品牌贡献；这是固定快照的公开兼容公式。",
  "指标：订单数=COUNT(DISTINCT order_id)；订单收入=SUM(order_total)；客户订单总金额=先按 customer_id 对 order_total 求和；客单价=AVG(order_total)；销量=SUM(quantity)；明细收入=SUM(quantity*unit_price)；平均评分=AVG(rating)；平均配送时长=AVG(delivery_time_minutes)；营销收入=SUM(revenue_generated)；营销投入=SUM(spend)。",
  "关键复合口径：比较客户与其分群平均值时，分群平均客户订单金额=先得到每个客户的 SUM(order_total)，再按 customer_segment 对这些客户级总额求 AVG；不能直接对订单行 order_total 求平均。",
  "配送枚举：delivery_status 的准时值精确为 'On Time'；其余公开值为 'Slightly Delayed' 和 'Significantly Delayed'。异常订单数=总订单数-状态为 'On Time' 的订单数。平均配送延迟题按 delivery_time_minutes 的全部配送记录求平均，不先过滤 delayed。",
  "配送率：准时率=On Time订单数/总订单数；‘准时率低于90%/95%’比较该准时率，不比较异常率。结果中的异常订单数仍是总订单数-On Time订单数。所有配送状态与时长都来自 blinkit_delivery_performance，不从 blinkit_orders 猜测。",
  "配送输出：‘哪些配送人员/配送员的准时率低于95%’只输出 delivery_partner_id；只有问题明确要求率或异常订单数量时才输出对应指标。",
  "库存损坏率：先按 product_id 汇总 damaged_stock 和 stock_received，再计算 damaged/(damaged+received)；两列和 shelf_life_days 是数字文本，计算前转 numeric。品牌损坏题输出 brand、满足条件的 distinct product_count 与 avg_shelf_life，不输出内部 rank 列。",
  "输出纪律：中文‘哪些/谁’只输出被询问实体标识；只有出现‘及其/和它的/列出该指标’才追加指标。条件、分母、总量、rank 和排序键是计算脚手架，不自动成为输出列。‘占比是多少’输出分组维度和占比，不额外输出分子总量。",
  "极值：问题问‘哪些...最高/最低/最多/最少’时先计算指标，再用 RANK/DENSE_RANK 或与极值比较，只返回并列第一实体；不能只 ORDER BY 后返回全部实体。",
  "确定性排序：极值 RANK/DENSE_RANK 的窗口 ORDER BY 只含主指标，不能加入实体 ID，否则会破坏并列；筛选 rnk=1 后才在最终 ORDER BY 追加实体 ID。普通有序结果主指标相同再追加实体升序。品牌平均保质期结果按 avg_shelf_life DESC、brand ASC。",
  "日期：order_date 是日期文本；按年筛选使用 PostgreSQL EXTRACT(YEAR FROM order_date::date) 或等价安全表达式。",
  "物理说明：blinkit_inventory 与 blinkit_inventoryNew 是两个独立原始快照，不自动 UNION；除非题目明确要求，不推断二者等价或覆盖关系。",
].join("\n");

export function falconSemanticContext(testCase: PublicBenchmarkCase): string | null {
  if (testCase.database_id === "falcon_db_04") return FALCON_DB04_ONTOLOGY_CONTEXT;
  if (testCase.database_id === "falcon_db_15") return FALCON_DB15_ONTOLOGY_CONTEXT;
  if (testCase.database_id === "falcon_db_17") return FALCON_DB17_ONTOLOGY_CONTEXT;
  if (testCase.database_id === "falcon_db_18") return FALCON_DB18_ONTOLOGY_CONTEXT;
  if (testCase.database_id === "falcon_db_14") return FALCON_DB14_ONTOLOGY_CONTEXT;
  if (testCase.database_id === "falcon_db_24") return FALCON_DB24_ONTOLOGY_CONTEXT;
  if (testCase.database_id === "falcon_db_28") return FALCON_DB28_ONTOLOGY_CONTEXT;
  return null;
}
