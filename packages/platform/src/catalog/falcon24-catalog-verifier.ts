import {
  buildFalcon24E1CatalogInventory,
  type Falcon24E1CatalogInventory,
} from "@data-agent/contracts/evals";
import { z } from "zod";
import type { PostgresCatalogConnector } from "./postgres-catalog.js";

const PREFLIGHT_SQL = `/* data-agent:falcon24-catalog-verifier-preflight@1 */
select
  pg_catalog.current_setting('server_version_num')::integer as server_version_num,
  pg_catalog.current_database() as database_name,
  (select pg_catalog.count(*)::integer
     from pg_catalog.pg_namespace
    where nspname~'^falcon_db_(0[1-9]|1[0-9]|2[0-8])$') as falcon_schema_count,
  pg_catalog.to_regnamespace('falcon_db_24') is not null as target_present`;

const CREATE_WORK_TABLES_SQL = `/* data-agent:falcon24-catalog-verifier-work-tables@1 */
create temporary table falcon24_catalog_verifier_tables(
  table_name text primary key,
  columns jsonb not null,
  row_count bigint not null,
  null_count bigint not null
) on commit drop;
create temporary table falcon24_catalog_verifier_rows(
  table_name text not null,
  row_ordinal bigint not null,
  row_canonical text not null
) on commit drop`;

const COLLECT_INVENTORY_SQL = `/* data-agent:falcon24-catalog-verifier-collect@1 */
do $catalog_inventory$
declare
  table_row record;
  canonical_columns text;
  null_expression text;
  observed_rows bigint;
  observed_nulls bigint;
begin
  for table_row in
    select class.relname as table_name
      from pg_catalog.pg_class class
      join pg_catalog.pg_namespace namespace on namespace.oid=class.relnamespace
     where namespace.nspname='falcon_db_24' and class.relkind='r'
     order by class.relname
  loop
    select pg_catalog.string_agg(
      case
        when attribute.atttypid in (
          'real'::pg_catalog.regtype,
          'double precision'::pg_catalog.regtype
        ) then pg_catalog.format(
          'case when row_value.%1$I is null then ''null'' '
          'when row_value.%1$I::text in(''NaN'',''Infinity'',''-Infinity'') '
          'then pg_catalog.to_json(row_value.%1$I)::text '
          'when row_value.%1$I::text!~''[.eE]'' then row_value.%1$I::text||''.0'' '
          'else row_value.%1$I::text end',
          attribute.attname
        )
        else pg_catalog.format(
          'coalesce(pg_catalog.to_json(row_value.%I)::text,''null'')',
          attribute.attname
        )
      end,
      '||'',''||' order by attribute.attnum
    ),
    pg_catalog.string_agg(
      pg_catalog.format('(row_value.%I is null)::integer',attribute.attname),
      '+' order by attribute.attnum
    )
    into strict canonical_columns,null_expression
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid=
      pg_catalog.format('%I.%I','falcon_db_24',table_row.table_name)::regclass
      and attribute.attnum>0 and not attribute.attisdropped;

    execute pg_catalog.format(
      'select pg_catalog.count(*),coalesce(pg_catalog.sum(%s),0) from %I.%I row_value',
      null_expression,
      'falcon_db_24',
      table_row.table_name
    ) into strict observed_rows,observed_nulls;

    insert into falcon24_catalog_verifier_tables(table_name,columns,row_count,null_count)
    select table_row.table_name,
      pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'ordinal',attribute.attnum,
        'column_name',attribute.attname,
        'data_type',pg_catalog.format_type(attribute.atttypid,attribute.atttypmod),
        'is_nullable',not attribute.attnotnull
      ) order by attribute.attnum),
      observed_rows,
      observed_nulls
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid=
      pg_catalog.format('%I.%I','falcon_db_24',table_row.table_name)::regclass
      and attribute.attnum>0 and not attribute.attisdropped;

    execute pg_catalog.format(
      'insert into falcon24_catalog_verifier_rows(table_name,row_ordinal,row_canonical) '
      'select %L,pg_catalog.row_number() over(order by row_value.ctid),'
      '''[''||%s||'']'' from %I.%I row_value order by row_value.ctid',
      table_row.table_name,
      canonical_columns,
      'falcon_db_24',
      table_row.table_name
    );
  end loop;
end
$catalog_inventory$`;

const LOAD_INVENTORY_SQL = `/* data-agent:falcon24-catalog-verifier-result@1 */
with content as (
  select 'sha256:'||pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    '['||pg_catalog.string_agg(
      '['||pg_catalog.to_json(table_name)::text||','||row_canonical||']',
      ',' order by table_name,row_ordinal
    )||']','UTF8'
  )),'hex') as content_digest
  from falcon24_catalog_verifier_rows
)
select pg_catalog.jsonb_build_object(
  'schema_name','falcon_db_24',
  'tables',pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'table_name',table_name,
    'columns',columns,
    'row_count',row_count,
    'null_count',null_count
  ) order by table_name),
  'table_count',pg_catalog.count(*),
  'column_count',pg_catalog.sum(pg_catalog.jsonb_array_length(columns)),
  'row_count',pg_catalog.sum(row_count),
  'null_count',pg_catalog.sum(null_count),
  'content_digest',content.content_digest
) as inventory_material
from falcon24_catalog_verifier_tables
cross join content
group by content.content_digest`;

const preflightSchema = z.strictObject({
  server_version_num: z.coerce.number().int().min(170_000),
  database_name: z.literal("data_agent"),
  falcon_schema_count: z.coerce.number().int().nonnegative(),
  target_present: z.boolean(),
});

export async function verifyFalcon24CatalogInventory(
  connector: PostgresCatalogConnector,
): Promise<Falcon24E1CatalogInventory> {
  const client = await connector.connect();
  let transactionOpen = false;
  try {
    await client.query({ text: "begin isolation level repeatable read" });
    transactionOpen = true;
    await client.query({
      text: "select pg_catalog.set_config('statement_timeout','120000',true)",
    });
    const preflight = preflightSchema.parse((await client.query({ text: PREFLIGHT_SQL })).rows[0]);
    if (preflight.falcon_schema_count !== 1 || !preflight.target_present) {
      throw new TypeError("FALCON24_CATALOG_VERIFICATION_SCOPE_DRIFT");
    }
    await client.query({ text: CREATE_WORK_TABLES_SQL });
    await client.query({ text: COLLECT_INVENTORY_SQL });
    const result = await client.query<{ readonly inventory_material: unknown }>({
      text: LOAD_INVENTORY_SQL,
    });
    if (result.rows.length !== 1 || !result.rows[0]) {
      throw new TypeError("FALCON24_CATALOG_VERIFICATION_RESULT_INVALID");
    }
    const inventory = await buildFalcon24E1CatalogInventory(result.rows[0].inventory_material);
    await client.query({ text: "rollback" });
    transactionOpen = false;
    return inventory;
  } catch (error) {
    if (transactionOpen) await client.query({ text: "rollback" }).catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
