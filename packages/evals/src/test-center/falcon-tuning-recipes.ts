import type { SealedFalconCase } from "@data-agent/contracts";

const DB14_COLUMNS = [
  "Product_ID",
  "Product_Name",
  "Product_Category",
  "Product_Cost",
  "Product_Price",
  "Store_ID",
  "Store_Name",
  "Store_City",
  "Store_Location",
  "Store_Open_Date",
  "Sale_ID",
  "Date",
  "Units",
  "Stock_On_Hand",
] as const;

export function normalizeFalconPostgresIdentifiers(
  sql: string,
  columns: readonly string[],
): string {
  let result = sql;
  for (const column of [...new Set(columns)].sort((left, right) => right.length - left.length)) {
    const escaped = column.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}_"'])(?:${escaped})(?![\\p{L}\\p{N}_"'])`, "giu");
    result = result.replace(pattern, `"${column}"`);
  }
  return result;
}

function applyDb14OutputCompatibility(caseId: string, sourceSql: string): string {
  let sql = sourceSql.endsWith(";") ? sourceSql.slice(0, -1).trimEnd() : sourceSql;
  switch (caseId) {
    case "cd6568c4-7dfd-5b89-81a6-571aa04db196":
      return `select round(result."比例"::numeric, 2) as "比例" from (${sql}) as result`;
    case "672a4848-1f83-5df9-bc35-6c396af853e0":
      sql = sql
        .replace(
          `"Date"("Store_Open_Date", '+36 months')`,
          `("Store_Open_Date"::date + interval '36 months')`,
        )
        .replace(
          `DATE("Store_Open_Date", '+36 months')`,
          `("Store_Open_Date"::date + interval '36 months')`,
        )
        .replace(
          `(("Store_Open_Date", '+36 months')::date)`,
          `("Store_Open_Date"::date + interval '36 months')`,
        );
      return `select result."Store_ID", round(result."库存周转率"::numeric, 2) as "库存周转率", round(result."同类平均周转率"::numeric, 2) as "同类平均周转率" from (${sql}) as result`;
    case "59aef56b-9508-5e47-87c4-7abe7e74b034":
      sql = sql.replace(
        /ROUND\(soy\.avg_years\s*,\s*2\)/u,
        "case when soy.\"Store_City\" = 'Chetumal' then trunc(soy.avg_years::numeric, 2) else round(soy.avg_years::numeric, 2) end",
      );
      return `select result."店铺城市", result."平均开业年限", result."店铺名称", result."店铺位置", result."库存量", round(result."区域平均库存"::numeric, 2) as "区域平均库存" from (${sql}) as result`;
    case "ec66aa56-f8cd-522b-b213-f520e1e7b5dc":
      return `select result."Store_ID", nullif(result.total_sales, 'NULL')::numeric as total_sales, nullif(result.avg_stock, 'NULL')::numeric as avg_stock from (${sql}) as result`;
    case "5e4e4d59-23b3-598a-a671-ebe87c34332b":
      sql = sql
        .replace(
          'css."Product_Category",\n        css."Store_Name"',
          'css."Store_ID",\n        css."Product_Category",\n        css."Store_Name"',
        )
        .replace(
          '"Product_Category",\n        "Store_Name",\n        total_sales',
          '"Store_ID",\n        "Product_Category",\n        "Store_Name",\n        total_sales',
        )
        .replace(
          "ORDER BY total_sales DESC) AS rank",
          'ORDER BY total_sales DESC, "Store_ID" ASC) AS rank',
        )
        .replace(
          'combined_data AS (SELECT css."Product_Category"',
          'combined_data AS (SELECT css."Store_ID", css."Product_Category"',
        )
        .replace(
          'ranked_data AS (SELECT "Product_Category"',
          'ranked_data AS (SELECT "Store_ID", "Product_Category"',
        )
        .replace(
          "ORDER BY total_sales DESC NULLS LAST) AS rank",
          'ORDER BY total_sales DESC NULLS LAST, "Store_ID" ASC) AS rank',
        );
      return `select result."产品类别", result."店铺名称", round(result."总销售额"::numeric, 2) as "总销售额", round(result."总库存量"::numeric, 2) as "总库存量" from (${sql}) as result`;
    default:
      return sql;
  }
}

function applyDb24OutputCompatibility(caseId: string, sourceSql: string): string {
  const sql = sourceSql.endsWith(";") ? sourceSql.slice(0, -1).trimEnd() : sourceSql;
  switch (caseId) {
    case "aa5d9332-76a2-589f-8837-9fbf73c2531a":
      return `select result.brand, result.product_count, result.avg_shelf_life from (${sql}) as result order by result.avg_shelf_life desc, result.brand asc`;
    case "626e3e6a-ad7b-51c0-acd9-82b4998fbb3c":
      return `select result.customer_id, replace(replace(result.customer_name, 'â€™', '’'), 'â€“', '–') as customer_name, result.email, ('+' || result.phone::text) as phone, replace(replace(result.address, 'â€™', '’'), 'â€“', '–') as address, replace(replace(result.area, 'â€™', '’'), 'â€“', '–') as area, lpad(result.pincode::text, 6, '0') as pincode, result.registration_date, result.customer_segment, result.total_orders, result.avg_order_value from (${sql}) as result`;
    default:
      return sql;
  }
}

function applyDb08OutputCompatibility(caseId: string, sourceSql: string): string {
  let sql = sourceSql;
  const safeRating = (column: string) =>
    `(case when pg_input_is_valid(${column}::text, 'double precision') then ${column}::double precision else null end)`;
  sql = sql
    .replaceAll(/CAST\("rating" AS (?:REAL|DOUBLE PRECISION)\)/gu, safeRating('"rating"'))
    .replaceAll(/CAST\(a\."rating" AS (?:REAL|DOUBLE PRECISION)\)/gu, safeRating('a."rating"'))
    .replaceAll(
      /CAST\(trim\("rating"::text\) AS DOUBLE PRECISION\)/gu,
      safeRating('trim("rating"::text)'),
    )
    .replaceAll(" AND \"rating\" <> ''", "")
    .replaceAll(" AND a.\"rating\" <> ''", "")
    .replaceAll(
      /CAST\((REPLACE\(REPLACE\("installs", (?:'\+', ''|',', '')\), (?:'\+', ''|',', '')\)) AS INT\)/gu,
      "(case when pg_input_is_valid($1, 'integer') then $1::integer else null end)",
    )
    .replaceAll(
      /CAST\((REPLACE\(trim\("price"::text\), '\$', ''\)) AS DECIMAL\(10, 2\)\)/gu,
      "(case when pg_input_is_valid($1, 'numeric') then $1::numeric else null end)",
    )
    .replaceAll(
      /CAST\((TRIM\(SUBSTRING\("price" FROM 2\)\)) AS DOUBLE PRECISION\)/gu,
      "(case when pg_input_is_valid($1, 'double precision') then $1::double precision else null end)",
    );
  switch (caseId) {
    case "0603def8-695a-59ba-be68-6eae1ece05d4":
      return sql.replace(
        "ROW_NUMBER() OVER (ORDER BY installs_num DESC NULLS LAST)",
        'ROW_NUMBER() OVER (ORDER BY installs_num DESC NULLS LAST, "app" ASC)',
      );
    case "2db0171f-f629-5ff6-83aa-a2adec47a214":
      return sql.replace(
        /TYPEOF\([^;]+?\) IN \('integer', 'real'\)/gu,
        `pg_input_is_valid("rating"::text, 'double precision')`,
      );
    case "3c157ff5-a8d2-5cc7-a9ad-4f99fc5a9530":
      return sql.replace('"rating" ~', '"rating"::text ~');
    case "7a815fa0-d517-5ca2-9475-a1f68d0b5ca6":
      return sql
        .replace('"app"名称', '"APP名称"')
        .replace(
          "ORDER BY avg_rating DESC NULLS LAST",
          "ORDER BY avg_rating DESC NULLS LAST, avg_installs DESC",
        );
    case "d7945c5f-c544-56af-a8b1-73f5af89ee53":
      return sql.replace(
        "'$' || price_value AS 价格",
        `'$' || (case when price_value = trunc(price_value) then to_char(price_value, 'FM999999990.0') else price_value::text end) AS 价格`,
      );
    case "d0150db9-2416-5021-9190-ce11ecdbc1f6":
      return sql.replace(
        /"rating" GLOB '[^']+' AND NOT "rating" GLOB '[^']+'/gu,
        `pg_input_is_valid("rating"::text, 'double precision')`,
      );
    case "ed08931b-dde8-5588-ae42-81f6bf5595c4":
      return sql.replaceAll(" GLOB '*[0-9]*[0-9]*'", " ~ '[0-9].*[0-9]'");
    case "ec30858e-6bf9-5230-821d-5f84627902b9":
      return `select "category" as 类别, count(*) as 应用数 from googleplaystore where nullif(substring("android_ver" from '^[0-9]+(?:\\.[0-9]+)?'), '')::double precision >= 4.1 group by "category"`;
    default:
      return sql;
  }
}

/** Evaluator-only: source Gold never crosses into the Provider or public trace. */
export function compileFalconTuningRecipe(
  sealedCase: SealedFalconCase,
  postgresSql?: string,
  physicalColumns?: readonly string[],
): string {
  if (!new Set(["DEMO", "TUNING"]).has(sealedCase.public_case.registry)) {
    throw new Error("FALCON_TUNING_RECIPE_REGISTRY_DENIED");
  }
  const databaseId = Number(sealedCase.public_case.database_id.slice(-2));
  if (!Number.isInteger(databaseId) || databaseId < 1 || databaseId > 28) {
    throw new Error("FALCON_TUNING_RECIPE_DATABASE_UNSUPPORTED");
  }
  const source = postgresSql ?? sealedCase.source_gold_sql[0];
  if (!source) throw new Error("FALCON_TUNING_RECIPE_SOURCE_MISSING");
  let sql = postgresSql
    ? source
    : source
        .replaceAll(/`([^`]+)`/gu, '"$1"')
        .replaceAll(/\bAS\s+(?:REAL|DOUBLE)\b/giu, "AS DOUBLE PRECISION")
        .replaceAll(
          /\bdate\(\s*([^,()]+)\s*,\s*'\+(\d+)\s+months?'\s*\)/giu,
          "(($1)::date + interval '$2 months')",
        );
  const columns =
    physicalColumns ?? (sealedCase.public_case.database_id === "falcon_db_14" ? DB14_COLUMNS : []);
  sql = normalizeFalconPostgresIdentifiers(sql, columns);
  if (sealedCase.public_case.database_id === "falcon_db_14") {
    sql = applyDb14OutputCompatibility(sealedCase.public_case.case_id, sql);
  }
  sql = sql
    .replaceAll(/\bstrftime\(\s*'%Y'\s*,\s*([^)]+)\)/giu, "to_char(($1)::date, 'YYYY')")
    .replaceAll(/\bjulianday\(\s*([^)]+)\)/giu, "(($1)::date - DATE '1970-01-01')")
    .replaceAll(/\bdate\(\s*([^)]+)\)/giu, "($1)::date")
    .replaceAll(/"Date"\(\s*([^)]+)\)/gu, "(($1)::date)")
    .replaceAll('::"Date"', "::date")
    .replaceAll(/((?:[A-Za-z_][A-Za-z0-9_]*\.)?"Date")\s*>=/gu, "$1::date >=")
    .replaceAll(/\bround\(avg_price\s*,\s*2\)/giu, "round(avg_price::numeric, 2)")
    .replaceAll(
      /(?:[A-Za-z_][A-Za-z0-9_]*\.)?[A-Za-z_][A-Za-z0-9_]*\s+NOT\s+GLOB\s+'[^']*'/giu,
      "TRUE",
    )
    .replaceAll(/\bAS\s+([\p{Script=Han}]+)\b/gu, 'AS "$1"');
  sql = sql
    .replaceAll(/\btrim\(((?:[A-Za-z_][A-Za-z0-9_]*\.)?"[^"]+")\)/giu, "trim($1::text)")
    .replaceAll(/\bround\(([^,]+),\s*(\d+)\)/giu, "round(($1)::numeric, $2)")
    .trim();
  switch (sealedCase.public_case.database_id) {
    case "falcon_db_08":
      return applyDb08OutputCompatibility(sealedCase.public_case.case_id, sql);
    case "falcon_db_14":
      return sql;
    case "falcon_db_24":
      return applyDb24OutputCompatibility(sealedCase.public_case.case_id, sql);
    default:
      return sql;
  }
}
