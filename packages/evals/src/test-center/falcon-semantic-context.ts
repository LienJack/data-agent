import type { PublicBenchmarkCase } from "@data-agent/contracts";

export const FALCON_DB14_ONTOLOGY_CONTEXT = [
  "Falcon db14 公开语义本体：",
  "业务主体：商品(toy_products)、门店(toy_stores)、销售(toy_sales)、库存快照(toy_inventory)。",
  "关系：销售通过 Product_ID 指向商品、通过 Store_ID 指向门店；库存通过 Product_ID 指向商品、通过 Store_ID 指向门店。",
  "维度：商品类目 Product_Category、门店位置 Store_Location、销售日期 Date。",
  "指标：库存量=SUM(Stock_On_Hand)；销量=SUM(Units)；销售额=SUM(Units * Product_Price)。",
  "口径：库存是门店-商品粒度的快照；跨门店汇总时先按 Product_ID 聚合，再关联商品名称。",
].join("\n");

export const FALCON_DB24_ONTOLOGY_CONTEXT = [
  "Falcon db24 Blinkit 公开语义本体：",
  "业务主体：客户、订单、订单明细、商品、客户反馈、配送履约、库存快照、营销活动。",
  "主体标识：客户由 customer_id 稳定标识；题目问‘哪些客户’且未明确要求姓名时，输出 customer_id，不额外输出客户名称、分群或中间指标。",
  "主体关系：订单.customer_id→客户.customer_id；订单明细.order_id→订单.order_id；订单明细.product_id→商品.product_id；客户反馈.order_id/customer_id→订单/客户；配送履约.order_id→订单；库存.product_id→商品。",
  "维度：客户分群 customer_segment、订单日期 order_date、配送状态 delivery_status、支付方式 payment_method、商品类目 category、品牌 brand、反馈类别 feedback_category、情感 sentiment、营销渠道 channel。",
  "指标：订单数=COUNT(DISTINCT order_id)；订单收入=SUM(order_total)；客户订单总金额=先按 customer_id 对 order_total 求和；客单价=AVG(order_total)；销量=SUM(quantity)；明细收入=SUM(quantity*unit_price)；平均评分=AVG(rating)；平均配送时长=AVG(delivery_time_minutes)；营销收入=SUM(revenue_generated)；营销投入=SUM(spend)。",
  "关键复合口径：比较客户与其分群平均值时，分群平均客户订单金额=先得到每个客户的 SUM(order_total)，再按 customer_segment 对这些客户级总额求 AVG；不能直接对订单行 order_total 求平均。",
  "物理说明：blinkit_inventory 与 blinkit_inventoryNew 是两个独立原始快照，不自动 UNION；除非题目明确要求，不推断二者等价或覆盖关系。",
].join("\n");

export function falconSemanticContext(testCase: PublicBenchmarkCase): string | null {
  if (testCase.database_id === "falcon_db_14") return FALCON_DB14_ONTOLOGY_CONTEXT;
  if (testCase.database_id === "falcon_db_24") return FALCON_DB24_ONTOLOGY_CONTEXT;
  return null;
}
