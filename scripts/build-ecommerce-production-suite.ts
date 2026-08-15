import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

const suiteRoot = resolve("infra/agenticdatabench/ecommerce-v1/production-suite");
const tableNames = [
  "dim_date", "dim_customer", "dim_seller", "dim_category", "dim_product", "dim_geolocation_zip",
  "dim_amazon_product", "dim_ebay_listing", "fact_order", "fact_order_item", "fact_payment",
  "fact_review", "fact_amazon_review", "fact_delivery_state_month",
] as const;
const difficulty = z.enum(["simple", "moderate", "challenging"]);
const registry = z.enum(["DEMO", "TUNING", "HOLDOUT"]);
const outputType = z.enum(["CSV", "JSON", "MARKDOWN", "VEGA_LITE", "PNG"]);
const sourceCaseSchema = z.strictObject({
  ordinal: z.number().int().min(1).max(24),
  title: z.string().min(1),
  question: z.string().min(1),
  registry,
  difficulty,
  tables: z.array(z.enum(tableNames)).min(1),
  capabilities: z.array(z.enum(["TEXT_TO_SQL", "PYTHON_ANALYSIS", "DATA_AGENT_END_TO_END"])).min(1),
  outputs: z.array(outputType).min(1),
  gold_sql: z.string().min(1),
  python_required: z.boolean(),
  chart_or_report_required: z.boolean(),
});
type SourceCase = z.infer<typeof sourceCaseSchema>;
const c = (
  ordinal: number, title: string, question: string, registryValue: SourceCase["registry"],
  difficultyValue: SourceCase["difficulty"], tables: SourceCase["tables"], goldSql: string,
  pythonRequired = false, chartOrReportRequired = false,
): SourceCase => sourceCaseSchema.parse({
  ordinal, title, question, registry: registryValue, difficulty: difficultyValue, tables,
  capabilities: pythonRequired ? ["TEXT_TO_SQL", "PYTHON_ANALYSIS", "DATA_AGENT_END_TO_END"] : ["TEXT_TO_SQL"],
  outputs: chartOrReportRequired ? ["JSON", "VEGA_LITE", "MARKDOWN"] : pythonRequired ? ["JSON"] : ["CSV"],
  gold_sql: goldSql, python_required: pythonRequired, chart_or_report_required: chartOrReportRequired,
});

const orderCount = "select count(*)::bigint as order_count from demo_adb_ecommerce_mart.fact_order";
const cases: SourceCase[] = [
  c(1,"订单规模快照","统计订单总量，并说明数据快照口径。","DEMO","simple",["fact_order"],orderCount),
  c(2,"支付方式结构","按支付方式统计支付笔数与金额，金额降序。","DEMO","simple",["fact_payment"],"select payment_type, count(*)::bigint payment_count, round(sum(payment_value_brl),2) payment_value_brl from demo_adb_ecommerce_mart.fact_payment group by payment_type order by payment_value_brl desc, payment_type"),
  c(3,"Amazon 品牌价格","统计有价格商品数最多的前十品牌及平均美元价格。","DEMO","simple",["dim_amazon_product"],"select brand, count(*)::bigint product_count, round(avg(price_usd),2) avg_price_usd from demo_adb_ecommerce_mart.dim_amazon_product where brand is not null and price_usd is not null group by brand order by product_count desc, brand limit 10"),
  c(4,"类目 GMV 与满意度","关联商品、订单明细和评价，仅保留 is_electronics=true 的商品；按订单明细中的英文类目分组，输出英文类目、GMV（口径为 sum(price_brl)，不含运费，2 位小数）、去重订单量和平均评分（3 位小数），并按 GMV 降序；没有评价的订单也保留在 GMV 与订单量中。","DEMO","moderate",["dim_category","dim_product","fact_order_item","fact_review"],"select i.category_name_english, round(sum(i.price_brl),2) gmv_brl, count(distinct i.order_id)::bigint orders, round(avg(r.review_score),3) avg_score from demo_adb_ecommerce_mart.fact_order_item i join demo_adb_ecommerce_mart.dim_product p on p.product_id=i.product_id join demo_adb_ecommerce_mart.dim_category c on c.category_name=p.category_name left join demo_adb_ecommerce_mart.fact_review r on r.order_id=i.order_id where c.is_electronics group by i.category_name_english order by gmv_brl desc"),
  c(5,"卖家履约排行","按卖家州计算订单、GMV、平均延迟和评分，只保留订单不少于 100 的州。","DEMO","moderate",["dim_seller","fact_order","fact_order_item","fact_review"],"select s.state seller_state,count(distinct o.order_id)::bigint orders,round(sum(i.price_brl),2) gmv_brl,round(avg(o.delivery_delay_days)::numeric,3) avg_delay,round(avg(r.review_score),3) avg_score from demo_adb_ecommerce_mart.fact_order o join demo_adb_ecommerce_mart.fact_order_item i on i.order_id=o.order_id join demo_adb_ecommerce_mart.dim_seller s on s.seller_id=i.seller_id left join demo_adb_ecommerce_mart.fact_review r on r.order_id=o.order_id group by s.state having count(distinct o.order_id)>=100 order by avg_delay, seller_state"),
  c(6,"月度 GMV 异常","计算月度 GMV 环比并用 Python 标准分数标记异常月份，输出 JSON。","DEMO","moderate",["dim_date","fact_order","fact_order_item"],"select to_char(o.purchase_date,'YYYY-MM') month_key,sum(i.price_brl)::double precision gmv_brl from demo_adb_ecommerce_mart.fact_order o join demo_adb_ecommerce_mart.fact_order_item i on i.order_id=o.order_id group by 1 order by 1",true),
  c(7,"客户复购与价值分层","以客户唯一标识聚合订单、GMV、评分、延迟与支付，计算复购率和价值分层，并生成 Vega-Lite 与结论报告。","DEMO","challenging",["dim_customer","fact_order","fact_order_item","fact_payment","fact_review","dim_product"],"with x as (select c.customer_unique_id,count(distinct o.order_id) orders,sum(i.price_brl) gmv_brl,avg(r.review_score) avg_score,avg(o.delivery_delay_days) avg_delay from demo_adb_ecommerce_mart.dim_customer c join demo_adb_ecommerce_mart.fact_order o on o.customer_id=c.customer_id join demo_adb_ecommerce_mart.fact_order_item i on i.order_id=o.order_id left join demo_adb_ecommerce_mart.fact_review r on r.order_id=o.order_id group by c.customer_unique_id) select * from x order by gmv_brl desc, customer_unique_id",true,true),
  c(8,"跨平台价格与满意度","对 Olist、Amazon、eBay 电子商品构建价格分位与评分相关性分析，披露不可确定实体匹配并输出图表报告。","DEMO","challenging",["dim_category","dim_product","fact_order_item","fact_review","dim_amazon_product","fact_amazon_review","dim_ebay_listing"],"select 'olist' platform,i.price_brl::double precision price,r.review_score::double precision rating from demo_adb_ecommerce_mart.fact_order_item i join demo_adb_ecommerce_mart.fact_review r on r.order_id=i.order_id where i.category_name_english in ('telephony','computers_accessories','electronics','consoles_games') union all select 'amazon',p.price_usd::double precision,r.rating::double precision from demo_adb_ecommerce_mart.dim_amazon_product p join demo_adb_ecommerce_mart.fact_amazon_review r on r.asin=p.asin where p.price_usd is not null",true,true),
  c(9,"评价分布","按评价星级统计数量。","TUNING","simple",["fact_review"],"select review_score,count(*)::bigint review_count from demo_adb_ecommerce_mart.fact_review group by review_score order by review_score"),
  c(10,"eBay 内存档位","按内存容量统计刊登量和平均价格。","TUNING","simple",["dim_ebay_listing"],"select ram_gb,count(*)::bigint listings,round(avg(price_usd),2) avg_price_usd from demo_adb_ecommerce_mart.dim_ebay_listing where ram_gb is not null group by ram_gb order by ram_gb"),
  c(11,"客户地域贡献","按客户州统计订单量、客户数与 GMV。","TUNING","moderate",["dim_customer","fact_order","fact_order_item"],"select c.state,count(distinct o.order_id)::bigint orders,count(distinct c.customer_unique_id)::bigint customers,round(sum(i.price_brl),2) gmv_brl from demo_adb_ecommerce_mart.dim_customer c join demo_adb_ecommerce_mart.fact_order o on o.customer_id=c.customer_id join demo_adb_ecommerce_mart.fact_order_item i on i.order_id=o.order_id group by c.state order by gmv_brl desc"),
  c(12,"运费价格弹性","按类目计算价格、运费及运费占比。","TUNING","moderate",["dim_product","fact_order_item"],"select category_name_english,round(sum(price_brl),2) gmv_brl,round(sum(freight_value_brl),2) freight_brl,round(sum(freight_value_brl)/nullif(sum(price_brl),0),4) freight_rate from demo_adb_ecommerce_mart.fact_order_item group by category_name_english order by freight_rate desc nulls last"),
  c(13,"支付与客单价","比较支付方式对应订单的客单价和分期数。","TUNING","moderate",["fact_order","fact_order_item","fact_payment"],"with g as (select order_id,sum(price_brl) gmv from demo_adb_ecommerce_mart.fact_order_item group by order_id) select p.payment_type,count(distinct p.order_id)::bigint orders,round(avg(g.gmv),2) avg_order_value,round(avg(p.installments),2) avg_installments from demo_adb_ecommerce_mart.fact_payment p join g on g.order_id=p.order_id group by p.payment_type order by orders desc"),
  c(14,"配送分位诊断","按卖家州计算配送延迟的 P50/P90/P95，并用 Python 输出异常州 JSON。","TUNING","moderate",["dim_seller","fact_order","fact_order_item"],"select s.state,percentile_cont(0.5) within group(order by o.delivery_delay_days) p50,percentile_cont(0.9) within group(order by o.delivery_delay_days) p90,percentile_cont(0.95) within group(order by o.delivery_delay_days) p95 from demo_adb_ecommerce_mart.fact_order o join demo_adb_ecommerce_mart.fact_order_item i on i.order_id=o.order_id join demo_adb_ecommerce_mart.dim_seller s on s.seller_id=i.seller_id where o.delivery_delay_days is not null group by s.state order by p95 desc",true),
  c(15,"电子类目漏斗","构建购买、支付、签收、评价漏斗，按月和类目计算转化并生成报告。","TUNING","challenging",["dim_category","dim_product","fact_order","fact_order_item","fact_payment","fact_review"],"select to_char(o.purchase_date,'YYYY-MM') month_key,i.category_name_english,count(distinct o.order_id)::bigint purchased,count(distinct p.order_id)::bigint paid,count(distinct case when o.delivered_at is not null then o.order_id end)::bigint delivered,count(distinct r.order_id)::bigint reviewed from demo_adb_ecommerce_mart.fact_order o join demo_adb_ecommerce_mart.fact_order_item i on i.order_id=o.order_id join demo_adb_ecommerce_mart.dim_product pr on pr.product_id=i.product_id join demo_adb_ecommerce_mart.dim_category c on c.category_name=pr.category_name left join demo_adb_ecommerce_mart.fact_payment p on p.order_id=o.order_id left join demo_adb_ecommerce_mart.fact_review r on r.order_id=o.order_id where c.is_electronics group by 1,2 order by 1,2",true,true),
  c(16,"卖家风险综合评分","综合 GMV、订单、延迟、低评分、运费和距离，以 Python 生成标准化风险分及解释。","TUNING","challenging",["dim_seller","dim_customer","dim_geolocation_zip","fact_order","fact_order_item","fact_review","fact_delivery_state_month"],"select s.seller_id,s.state,count(distinct o.order_id)::bigint orders,sum(i.price_brl)::double precision gmv,avg(o.delivery_delay_days) avg_delay,avg(case when r.review_score<=2 then 1.0 else 0.0 end) low_score_rate,avg(i.freight_value_brl) avg_freight from demo_adb_ecommerce_mart.dim_seller s join demo_adb_ecommerce_mart.fact_order_item i on i.seller_id=s.seller_id join demo_adb_ecommerce_mart.fact_order o on o.order_id=i.order_id left join demo_adb_ecommerce_mart.fact_review r on r.order_id=o.order_id group by s.seller_id,s.state",true,true),
  c(17,"州对履约趋势","用窗口函数识别连续三个月恶化的州对，并关联客户卖家规模解释。","TUNING","challenging",["fact_delivery_state_month","dim_customer","dim_seller","fact_order","fact_order_item","fact_review"],"with x as (select *,lag(avg_delivery_delay_days) over(partition by seller_state,customer_state order by purchase_month) prev_delay from demo_adb_ecommerce_mart.fact_delivery_state_month) select * from x where avg_delivery_delay_days>prev_delay order by seller_state,customer_state,purchase_month"),
  c(18,"跨平台硬件价格模型","联合 eBay RAM/SSD、Amazon 品牌价格和 Olist 电子品交易，计算相关性与稳健统计报告。","TUNING","challenging",["dim_ebay_listing","dim_amazon_product","fact_amazon_review","dim_product","dim_category","fact_order_item","fact_review"],"select brand,ram_gb,ssd_gb,price_usd from demo_adb_ecommerce_mart.dim_ebay_listing where price_usd is not null and (ram_gb is not null or ssd_gb is not null)",true,true),
  c(19,"订单状态","按订单状态统计订单量。","HOLDOUT","simple",["fact_order"],"select order_status,count(*)::bigint orders from demo_adb_ecommerce_mart.fact_order group by order_status order by orders desc,order_status"),
  c(20,"商品体积与价格","按类目比较商品体积、重量和成交价。","HOLDOUT","moderate",["dim_product","fact_order_item"],"select p.category_name_english,avg(p.length_cm*p.height_cm*p.width_cm) avg_volume_cm3,avg(p.weight_g) avg_weight_g,avg(i.price_brl) avg_price_brl from demo_adb_ecommerce_mart.dim_product p join demo_adb_ecommerce_mart.fact_order_item i on i.product_id=p.product_id group by p.category_name_english order by avg_price_brl desc nulls last"),
  c(21,"复购间隔","计算复购客户的首次、末次购买日期和复购间隔。","HOLDOUT","moderate",["dim_customer","fact_order"],"select c.customer_unique_id,min(o.purchase_date) first_date,max(o.purchase_date) last_date,count(distinct o.order_id)::bigint orders,(max(o.purchase_date)-min(o.purchase_date)) repurchase_span_days from demo_adb_ecommerce_mart.dim_customer c join demo_adb_ecommerce_mart.fact_order o on o.customer_id=c.customer_id group by c.customer_unique_id having count(distinct o.order_id)>1 order by orders desc,customer_unique_id"),
  c(22,"评分响应时效","按评分统计评价创建到答复的平均时长。","HOLDOUT","moderate",["fact_review","fact_order"],"select review_score,avg(extract(epoch from (answered_at-created_at))/3600.0) avg_response_hours,count(*)::bigint reviews from demo_adb_ecommerce_mart.fact_review where answered_at>=created_at group by review_score order by review_score"),
  c(23,"履约与满意度归因","分析配送延迟、距离、运费、商品价格、卖家州和客户州与低评分的关系。","HOLDOUT","challenging",["dim_customer","dim_seller","dim_geolocation_zip","fact_order","fact_order_item","fact_review","fact_delivery_state_month"],"select s.state seller_state,c.state customer_state,avg(o.delivery_delay_days) avg_delay,avg(i.freight_value_brl) avg_freight,avg(i.price_brl) avg_price,avg(case when r.review_score<=2 then 1.0 else 0.0 end) low_score_rate,count(distinct o.order_id)::bigint orders from demo_adb_ecommerce_mart.fact_order o join demo_adb_ecommerce_mart.dim_customer c on c.customer_id=o.customer_id join demo_adb_ecommerce_mart.fact_order_item i on i.order_id=o.order_id join demo_adb_ecommerce_mart.dim_seller s on s.seller_id=i.seller_id left join demo_adb_ecommerce_mart.fact_review r on r.order_id=o.order_id group by s.state,c.state order by orders desc"),
  c(24,"季度经营复盘","形成客户、卖家、类目、支付、评价、履约和跨平台价格的季度经营复盘，输出图表与可验证主张。","HOLDOUT","challenging",["dim_customer","dim_seller","dim_category","dim_product","fact_order","fact_order_item","fact_payment","fact_review","dim_amazon_product","dim_ebay_listing"],"select to_char(o.purchase_date,'YYYY-Q') quarter,count(distinct o.order_id)::bigint orders,sum(i.price_brl)::double precision gmv,avg(r.review_score) avg_score,avg(o.delivery_delay_days) avg_delay from demo_adb_ecommerce_mart.fact_order o join demo_adb_ecommerce_mart.fact_order_item i on i.order_id=o.order_id left join demo_adb_ecommerce_mart.fact_review r on r.order_id=o.order_id group by 1 order by 1",true,true),
];

function hash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
const publicCases = cases.map(({ gold_sql: _gold, ...item }) => ({
  case_id: `ec100000-0000-4000-8000-${String(item.ordinal).padStart(12, "0")}`,
  suite_id: "ecommerce-production",
  suite_version: "1.0.0",
  dataset_version: "adb-ecommerce-bounded-v1",
  ...item,
}));
const publicWithHashes = publicCases.map((item) => ({ ...item, public_case_hash: hash(item) }));
const sealed = cases.map((item, index) => ({
  public_case: publicWithHashes[index],
  gold_sql: item.gold_sql,
  oracle_policy: "postgres-result-and-artifact-rules@1.0.0",
  sealed_case_hash: hash({ public_case_hash: publicWithHashes[index]?.public_case_hash, gold_sql: item.gold_sql }),
}));
const manifest = {
  schema_version: "ecommerce-production-suite-manifest@1.0.0",
  suite_id: "ecommerce-production",
  suite_version: "1.0.0",
  dataset_digest: "sha256:54632f39e190c872d2b5c176090ebc2d3b77e135b9bb5aecc96d6bf6d0fa4518",
  case_count: cases.length,
  registry_counts: Object.fromEntries(registry.options.map((value) => [value, cases.filter((item) => item.registry === value).length])),
  difficulty_counts: Object.fromEntries(difficulty.options.map((value) => [value, cases.filter((item) => item.difficulty === value).length])),
  hard_six_table_count: cases.filter((item) => item.difficulty === "challenging" && item.tables.length >= 6).length,
  python_case_count: cases.filter((item) => item.python_required).length,
  chart_or_report_case_count: cases.filter((item) => item.chart_or_report_required).length,
  public_cases_sha256: hash(publicWithHashes),
  sealed_cases_sha256: hash(sealed),
  readiness: "HOLD",
  readiness_reason: "Runner and sealed artifact Oracle require end-to-end certification before READY.",
};
await mkdir(resolve(suiteRoot, "sealed"), { recursive: true });
await Promise.all([
  writeFile(resolve(suiteRoot, "public-cases.json"), `${JSON.stringify(publicWithHashes, null, 2)}\n`),
  writeFile(resolve(suiteRoot, "sealed/sealed-cases.json"), `${JSON.stringify(sealed, null, 2)}\n`),
  writeFile(resolve(suiteRoot, "manifest.json"), `${JSON.stringify({ ...manifest, manifest_sha256: hash(manifest) }, null, 2)}\n`),
]);
console.log(JSON.stringify(manifest));
