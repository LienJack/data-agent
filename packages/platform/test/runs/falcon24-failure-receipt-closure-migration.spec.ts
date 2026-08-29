import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const migrationPath = resolve(
  repositoryRoot,
  "infra/supabase/apps/data-agent/migrations/20260725010804_app_data_agent_falcon24_failure_receipt_closure.sql",
);
const predecessorPath = resolve(
  repositoryRoot,
  "infra/supabase/apps/data-agent/migrations/20260725010803_app_data_agent_falcon24_four_layer_gate.sql",
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const predecessor = existsSync(predecessorPath) ? readFileSync(predecessorPath, "utf8") : "";
const checksumHeader =
  /^-- falcon24_failure_receipt_closure_migration_checksum: sha256:([0-9a-f]{64})$/mu.exec(
    migration,
  )?.[1];

function businessReceiptFunctionSource(document: string): string {
  const signature =
    "function app_data_agent.record_falcon24_four_layer_business_receipt(command jsonb)";
  const signatureIndex = document.indexOf(signature);
  const delimiter = "as $function$";
  const sourceStart = document.indexOf(delimiter, signatureIndex) + delimiter.length;
  const sourceEnd = document.indexOf("$function$;", sourceStart);
  if (signatureIndex < 0 || sourceStart < delimiter.length || sourceEnd < sourceStart) return "";
  return document.slice(sourceStart, sourceEnd);
}

describe("10804 Falcon24 business failure receipt closure", () => {
  it("is rendered, checksummed, forward-only, and based on exact 10803", () => {
    expect(checksumHeader).toMatch(/^[0-9a-f]{64}$/u);
    const checksum = checksumHeader ?? "";
    expect(migration.split(checksum)).toHaveLength(3);
    expect(
      createHash("sha256")
        .update(migration.replaceAll(checksum, "0".repeat(64)))
        .digest("hex"),
    ).toBe(checksum);
    expect(migration).toContain("20260725010803_app_data_agent_falcon24_four_layer_gate");
    expect(migration).toContain("platform.acquire_migration_lock");
    expect(migration).toContain("platform.assert_migration_checksum");
  });

  it("replaces only the business receipt RPC from the exact predecessor source", () => {
    expect(migration).toContain(
      "create or replace function app_data_agent.record_falcon24_four_layer_business_receipt(command jsonb)",
    );
    expect(migration).toContain("20fdae60520ccfb3256babbea7240c3df8c412670794232eae662fe8a8eace02");
    expect(migration).toContain("f39c7dfd4002d455003646f16ea9066f34593154b2236220d7bb7789bec664c0");
    expect(
      createHash("sha256").update(businessReceiptFunctionSource(predecessor)).digest("hex"),
    ).toBe("20fdae60520ccfb3256babbea7240c3df8c412670794232eae662fe8a8eace02");
    expect(
      createHash("sha256").update(businessReceiptFunctionSource(migration)).digest("hex"),
    ).toBe("f39c7dfd4002d455003646f16ea9066f34593154b2236220d7bb7789bec664c0");
    expect(migration).toContain(
      "if receipt->>'status'='PASS' and not app_data_agent.falcon24_four_layer_agent_contract_matches(",
    );
    expect(migration.match(/create or replace function/gu)).toHaveLength(1);
    expect(migration).not.toMatch(/\b(create|alter|drop)\s+table\b/iu);
  });

  it("allows observed Agent mismatch only for FAIL and retains PASS closure fences", () => {
    const functionStart = migration.indexOf(
      "create or replace function app_data_agent.record_falcon24_four_layer_business_receipt",
    );
    const functionEnd = migration.indexOf("\n$function$;", functionStart);
    const businessFunction = migration.slice(functionStart, functionEnd);

    expect(businessFunction).toContain("receipt->>'status'='PASS' and not");
    expect(businessFunction).toContain("FALCON24_FOUR_LAYER_AGENT_CONTRACT_MISMATCH");
    expect(businessFunction).toContain("FALCON24_FOUR_LAYER_RUBRIC_CLOSURE_INVALID");
    expect(businessFunction).toContain("status=case when receipt->>'status'='PASS'");
    expect(businessFunction).toContain("first_failure_code=case when receipt->>'status'='FAIL'");
  });

  it("keeps protected history byte-identical and preserves the RPC security boundary", () => {
    expect(migration).toContain("falcon24_10804_history_snapshot");
    expect(migration).toContain("FALCON24_FAILURE_RECEIPT_HISTORY_DRIFT");
    expect(migration).toContain("owner_name<>'data_agent_u6_rpc_owner'");
    expect(migration).toContain("pg_catalog.has_function_privilege('public'");
    expect(migration).toContain("pg_catalog.has_function_privilege('data_agent_backend'");
    expect(migration).not.toMatch(/delete from app_data_agent\./iu);
    expect(migration).not.toMatch(/update semantic\./iu);
    expect(migration).not.toMatch(
      /update app_data_agent\.falcon24_(current|authority|qualification|acceptance)/iu,
    );
  });
});
