import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adaptPgCatalogPool,
  createPostgresCatalogScanner,
} from "../../src/catalog/postgres-catalog.js";
import { comparePhysicalSchemaSnapshots } from "../../src/catalog/schema-drift.js";

const adminDatabaseUrl = process.env.DATA_AGENT_TEST_ADMIN_DATABASE_URL;
const describePostgres = adminDatabaseUrl ? describe : describe.skip;
const adminConnectionString = adminDatabaseUrl ?? "postgresql://invalid.invalid/invalid";
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const schemaName = `catalog_m1_${suffix}`;
const roleName = `catalog_reader_${suffix}`;
const rolePassword = `m1-${randomUUID()}`;

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function scanInput(snapshotId: string, scanRunId: string) {
  return {
    request: {
      schema_version: "schema-scan-request@1.0.0",
      datasource_id: "pg17-fixture",
      include_schemas: [schemaName],
      page_size: 1,
      statement_timeout_ms: 10_000,
      idempotency_key: randomUUID(),
    },
    datasource_fingerprint: `sha256:${"a".repeat(64)}`,
    snapshot_id: snapshotId,
    scan_run_id: scanRunId,
    captured_at: new Date().toISOString(),
  };
}

describePostgres("PostgreSQL 17 catalog scanner", () => {
  const admin = new Pool({ connectionString: adminConnectionString });
  let reader: Pool;

  beforeAll(async () => {
    const schema = quoteIdentifier(schemaName);
    const role = quoteIdentifier(roleName);
    await admin.query(`create role ${role} login noinherit password ${quoteLiteral(rolePassword)}`);
    await admin.query(`create schema ${schema}`);
    await admin.query(`
      create table ${schema}.customers (
        id bigint primary key,
        email text not null unique
      );
      create table ${schema}.orders (
        id bigint primary key,
        customer_id bigint not null,
        amount integer default 0,
        legacy integer,
        constraint orders_id_check check (id > 0),
        constraint orders_customer_key unique (customer_id)
      );
      create index orders_lookup_idx on ${schema}.orders (amount);
      create sequence ${schema}.private_sequence;
      create function ${schema}.private_function() returns integer
        language sql as 'select 1';
      revoke all on function ${schema}.private_function() from public;
      grant connect on database ${quoteIdentifier(new URL(adminConnectionString).pathname.slice(1))} to ${role};
      grant usage on schema ${schema} to ${role};
    `);
    const readerUrl = new URL(adminConnectionString);
    readerUrl.username = roleName;
    readerUrl.password = rolePassword;
    reader = new Pool({ connectionString: readerUrl.toString(), max: 2 });
  });

  afterAll(async () => {
    await reader?.end();
    await admin.query(`drop schema if exists ${quoteIdentifier(schemaName)} cascade`);
    await admin.query(`drop owned by ${quoteIdentifier(roleName)}`);
    await admin.query(`drop role if exists ${quoteIdentifier(roleName)}`);
    await admin.end();
  });

  it("scans metadata with a minimum-permission role and detects real catalog drift", async () => {
    const scanner = createPostgresCatalogScanner(adaptPgCatalogPool(reader));
    const baseResult = await scanner.scan(scanInput(randomUUID(), randomUUID()));
    if (!baseResult.ok) throw new Error(baseResult.error.code);
    expect(baseResult).toMatchObject({ ok: true });

    const schema = quoteIdentifier(schemaName);
    await admin.query(`
      alter table ${schema}.orders alter column amount type bigint;
      alter table ${schema}.orders alter column customer_id drop not null;
      alter table ${schema}.orders drop column legacy;
      alter table ${schema}.orders add column renamed integer;
      alter table ${schema}.orders drop constraint orders_id_check;
      alter table ${schema}.orders add constraint orders_id_check check (id >= 0);
      alter table ${schema}.orders add constraint orders_customer_fkey
        foreign key (customer_id) references ${schema}.customers(id);
      drop index ${schema}.orders_lookup_idx;
      create index orders_lookup_idx on ${schema}.orders (renamed) where renamed is not null;
    `);

    const currentResult = await scanner.scan(scanInput(randomUUID(), randomUUID()));
    if (!currentResult.ok) throw new Error(currentResult.error.code);
    expect(currentResult).toMatchObject({ ok: true });
    const drift = comparePhysicalSchemaSnapshots(baseResult.value, currentResult.value, {
      drift_event_id: randomUUID(),
      observed_at: new Date().toISOString(),
    });

    expect(drift.operations.map((operation) => operation.operation_kind)).toEqual([
      "CHECK_CONSTRAINT_CHANGED",
      "COLUMN_ADDED",
      "COLUMN_NULLABILITY_CHANGED",
      "COLUMN_REMOVED",
      "COLUMN_TYPE_CHANGED",
      "FOREIGN_KEY_ADDED",
      "INDEX_CHANGED",
    ]);
    expect(currentResult.value.snapshot_content_hash).not.toBe(
      baseResult.value.snapshot_content_hash,
    );
  });

  it("cannot mutate data, DDL, sequences or ungranted functions", async () => {
    const schema = quoteIdentifier(schemaName);
    for (const sql of [
      `insert into ${schema}.orders(id, customer_id) values (1, 1)`,
      `update ${schema}.orders set amount = 1`,
      `delete from ${schema}.orders`,
      `create table ${schema}.forbidden(id integer)`,
      `alter table ${schema}.orders add column forbidden integer`,
      `select pg_catalog.nextval('${schemaName}.private_sequence')`,
      `select ${schema}.private_function()`,
    ]) {
      await expect(reader.query(sql)).rejects.toBeDefined();
    }
  });
});
