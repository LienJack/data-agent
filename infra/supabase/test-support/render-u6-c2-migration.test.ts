import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  assertFrozenU6C1InventoryProjection,
  buildU6C2CandidateInventory,
  defaultU6C2CandidatePaths,
  emptyU6C2InventorySurfaceDelta,
  renderU6C2MigrationCandidateFromSegments,
  U6_C1_FROZEN_MIGRATION_CHECKSUM,
  U6_C1_FROZEN_INVENTORY_HASH,
  U6_C2_CHECKSUM_PLACEHOLDER,
  U6_C2_FROZEN_MANIFEST_HASH,
  U6_C2_INVENTORY_REPLACEMENT_ALLOWLIST,
  U6_C2_MIGRATION_VERSION,
  U6_C2_SOURCE_SEGMENTS,
  U6_C2_ZERO_CHECKSUM,
  validateU6C2MaintenanceManifest,
  verifyU6C2GeneratedMigration,
  verifyImmutableU6C1Baseline,
  verifyU6C2AuthoringInputs,
} from "../../../scripts/render-u6-c2-migration.ts";

const temporaryDirectories: string[] = [];
const testSupportDirectory = resolve(fileURLToPath(import.meta.url), "..");
const repositoryRoot = resolve(testSupportDirectory, "../../..");
const defaultPaths = defaultU6C2CandidatePaths(repositoryRoot);
const unrelatedHash = `sha256:${"a".repeat(64)}`;
const expectedU6C2SourceSegments = [
  "00-preamble.sql.inc",
  "10-existing-relation-preflight-alterations.sql.inc",
  "20-budget-policy-events.sql.inc",
  "30-derivation-receipts.sql.inc",
  "40-input-event-watermark.sql.inc",
  "50-terminal-receipt-links.sql.inc",
  "60-cross-fks-indexes-triggers.sql.inc",
  "70-internal-functions.sql.inc",
  "71-run-locked-artifact-rpcs.sql.inc",
  "72-budget-resource-guard-rpcs.sql.inc",
  "73-stop-root-rpcs.sql.inc",
  "74-resolvers-provisioner.sql.inc",
  "80-lifecycle-cleanup.sql.inc",
  "90-rls-owner-grants.sql.inc",
  "99-postconditions-ledger-commit.sql.inc",
] as const;

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(resolve(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function writeCandidateSources(
  sourceDirectory: string,
  lineEnding: "\n" | "\r\n" | "\r" = "\n",
): void {
  mkdirSync(sourceDirectory, { recursive: true });
  for (const [index, segment] of expectedU6C2SourceSegments.entries()) {
    const lines = [`-- segment:${segment}`];
    if (segment === "00-preamble.sql.inc") {
      lines.push("begin;");
    }
    lines.push(`select '${index.toString().padStart(2, "0")}:${segment}';`);
    if (segment === "70-internal-functions.sql.inc") {
      lines.push(`select '${unrelatedHash}'::text;`);
    }
    if (segment === "99-postconditions-ledger-commit.sql.inc") {
      lines.push(
        "select platform.assert_migration_checksum(",
        "  'app',",
        "  '00000000-0000-4000-8000-00000000da01'::uuid,",
        `  '${U6_C2_MIGRATION_VERSION}',`,
        `  '${U6_C2_CHECKSUM_PLACEHOLDER}'`,
        ");",
        "",
        "commit;",
      );
    }
    writeFileSync(resolve(sourceDirectory, segment), `${lines.join(lineEnding)}${lineEnding}`);
  }
}

function readManifest(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(defaultPaths.c2MaintenanceManifestPath, "utf8"),
  ) as Record<string, unknown>;
}

function readBaselineInventory(): Record<string, unknown> {
  return JSON.parse(readFileSync(defaultPaths.c1.inventoryPath, "utf8")) as Record<
    string,
    unknown
  >;
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function finalLedgerBlock(checksum: string): string {
  return [
    "select platform.assert_migration_checksum(",
    "  'app',",
    "  '00000000-0000-4000-8000-00000000da01'::uuid,",
    `  '${U6_C2_MIGRATION_VERSION}',`,
    `  '${checksum}'`,
    ");",
    "",
    "commit;",
    "",
  ].join("\n");
}

describe("U6 C2 candidate authoring pipeline", () => {
  test("15 个 segment 依冻结顺序确定性渲染，且只替换 C2 checksum", () => {
    assert.equal(expectedU6C2SourceSegments.length, 15);
    assert.deepEqual(U6_C2_SOURCE_SEGMENTS, expectedU6C2SourceSegments);
    const sourceDirectory = resolve(temporaryDirectory("u6-c2-renderer-"), "sources");
    writeCandidateSources(sourceDirectory);

    const first = renderU6C2MigrationCandidateFromSegments(sourceDirectory);
    const second = renderU6C2MigrationCandidateFromSegments(sourceDirectory);

    assert.deepEqual(first, second);
    assert.match(
      first.content,
      /^-- u6_c2_migration_checksum: sha256:[0-9a-f]{64}$/m,
    );
    assert.ok(first.content.includes(unrelatedHash));
    let lastPosition = -1;
    for (const [index, segment] of expectedU6C2SourceSegments.entries()) {
      const position = first.content.indexOf(
        `${index.toString().padStart(2, "0")}:${segment}`,
      );
      assert.ok(position > lastPosition, `${segment} 未按冻结顺序渲染`);
      lastPosition = position;
    }
    assert.ok(first.content.endsWith(finalLedgerBlock(first.checksum)));
    assert.equal(first.content.split(first.checksum).length - 1, 2);
    const markerNormalized = first.content.replace(
      /^-- u6_c2_migration_checksum: sha256:[0-9a-f]{64}$/m,
      `-- u6_c2_migration_checksum: ${U6_C2_ZERO_CHECKSUM}`,
    );
    const independentlyNormalized = `${markerNormalized.slice(
      0,
      -finalLedgerBlock(first.checksum).length,
    )}${finalLedgerBlock(U6_C2_ZERO_CHECKSUM)}`;
    assert.equal(sha256(independentlyNormalized), first.checksum);
  });

  test("候选只允许首条 BEGIN 与最终 ledger 后的 COMMIT", () => {
    const sourceDirectory = resolve(
      temporaryDirectory("u6-c2-single-transaction-"),
      "sources",
    );
    const preamble = resolve(sourceDirectory, "00-preamble.sql.inc");
    const middleSegment = resolve(sourceDirectory, "20-budget-policy-events.sql.inc");

    writeCandidateSources(sourceDirectory);
    writeFileSync(preamble, readFileSync(preamble, "utf8").replace("begin;\n", ""));
    assert.throws(
      () => renderU6C2MigrationCandidateFromSegments(sourceDirectory),
      /必须以唯一顶层 BEGIN/,
    );

    for (const forbiddenTransactionControl of [
      "begin;",
      "commit;\nbegin;",
      "start transaction;",
      "end;",
      "rollback;",
      "abort;",
      "savepoint u6_c2;",
      "release savepoint u6_c2;",
      "release u6_c2;",
      "prepare transaction 'u6_c2';",
      "commit prepared 'u6_c2';",
      "rollback prepared 'u6_c2';",
    ]) {
      writeCandidateSources(sourceDirectory);
      writeFileSync(
        middleSegment,
        `${readFileSync(middleSegment, "utf8")}${forbiddenTransactionControl}\n`,
      );
      assert.throws(
        () => renderU6C2MigrationCandidateFromSegments(sourceDirectory),
        /禁止其他顶层事务控制/,
      );
    }

    for (const psqlMetaCommand of [
      String.raw`\gexec`,
      String.raw`\include /tmp/unreviewed.sql`,
      String.raw`\! true`,
    ]) {
      writeCandidateSources(sourceDirectory);
      writeFileSync(
        middleSegment,
        `${readFileSync(middleSegment, "utf8")}select 'commit;' as hidden_sql
${psqlMetaCommand}
`,
      );
      assert.throws(
        () => renderU6C2MigrationCandidateFromSegments(sourceDirectory),
        /禁止 psql meta-command/,
      );
    }
  });

  test("只归一化换行与尾部换行，其他 SQL byte 改动会改变 checksum", () => {
    const lfDirectory = resolve(temporaryDirectory("u6-c2-lf-"), "sources");
    const crlfDirectory = resolve(temporaryDirectory("u6-c2-crlf-"), "sources");
    writeCandidateSources(lfDirectory, "\n");
    writeCandidateSources(crlfDirectory, "\r\n");

    const lf = renderU6C2MigrationCandidateFromSegments(lfDirectory);
    const crlf = renderU6C2MigrationCandidateFromSegments(crlfDirectory);
    assert.deepEqual(crlf, lf);

    const changedPath = resolve(crlfDirectory, "20-budget-policy-events.sql.inc");
    writeFileSync(
      changedPath,
      readFileSync(changedPath, "utf8").replace("select '02:", "select 'changed:"),
    );
    const changed = renderU6C2MigrationCandidateFromSegments(crlfDirectory);
    assert.notEqual(changed.checksum, lf.checksum);
  });

  test("segment 少、多、名称漂移都在生成任何产物前失败", () => {
    const sourceDirectory = resolve(temporaryDirectory("u6-c2-segments-"), "sources");
    writeCandidateSources(sourceDirectory);
    const removed = resolve(sourceDirectory, expectedU6C2SourceSegments[3]);
    rmSync(removed);
    assert.throws(
      () => renderU6C2MigrationCandidateFromSegments(sourceDirectory),
      /闭集不匹配/,
    );

    writeFileSync(removed, "-- restored\n");
    writeFileSync(resolve(sourceDirectory, "85-extra.sql.inc"), "-- forbidden\n");
    assert.throws(
      () => renderU6C2MigrationCandidateFromSegments(sourceDirectory),
      /闭集不匹配/,
    );

    rmSync(resolve(sourceDirectory, "85-extra.sql.inc"));
    const original = resolve(sourceDirectory, expectedU6C2SourceSegments[4]);
    const changedName = resolve(sourceDirectory, "40-input-event-watermark-v2.sql.inc");
    cpSync(original, changedName);
    rmSync(original);
    assert.throws(
      () => renderU6C2MigrationCandidateFromSegments(sourceDirectory),
      /闭集不匹配/,
    );
  });

  test("placeholder 缺失、重复或脱离最终 10600 ledger 参数时失败", () => {
    const sourceDirectory = resolve(temporaryDirectory("u6-c2-placeholder-"), "sources");
    writeCandidateSources(sourceDirectory);
    const finalSegment = resolve(
      sourceDirectory,
      "99-postconditions-ledger-commit.sql.inc",
    );
    const original = readFileSync(finalSegment, "utf8");

    writeFileSync(finalSegment, original.replace(U6_C2_CHECKSUM_PLACEHOLDER, "missing"));
    assert.throws(
      () => renderU6C2MigrationCandidateFromSegments(sourceDirectory),
      /必须且只能出现一次/,
    );

    writeFileSync(
      finalSegment,
      original.replace(
        "commit;",
        `select '${U6_C2_CHECKSUM_PLACEHOLDER}';\ncommit;`,
      ),
    );
    assert.throws(
      () => renderU6C2MigrationCandidateFromSegments(sourceDirectory),
      /必须且只能出现一次/,
    );

    writeFileSync(
      finalSegment,
      `select '${U6_C2_CHECKSUM_PLACEHOLDER}';\ncommit;\n`,
    );
    assert.throws(
      () => renderU6C2MigrationCandidateFromSegments(sourceDirectory),
      /必须以冻结 ledger 调用和独立 COMMIT 结束/,
    );
  });

  test("注释、普通 SELECT 或伪 COMMIT 不能冒充最终 ledger", () => {
    const sourceDirectory = resolve(temporaryDirectory("u6-c2-comment-ledger-"), "sources");
    writeCandidateSources(sourceDirectory);
    const finalSegment = resolve(
      sourceDirectory,
      "99-postconditions-ledger-commit.sql.inc",
    );

    writeFileSync(
      finalSegment,
      `-- ${finalLedgerBlock(U6_C2_CHECKSUM_PLACEHOLDER).replaceAll("\n", "\n-- ")}`,
    );
    assert.throws(
      () => renderU6C2MigrationCandidateFromSegments(sourceDirectory),
      /冻结 ledger 调用/,
    );

    writeFileSync(
      finalSegment,
      `/* open block\n${finalLedgerBlock(U6_C2_CHECKSUM_PLACEHOLDER)}`,
    );
    assert.throws(
      () => renderU6C2MigrationCandidateFromSegments(sourceDirectory),
      /可执行 SQL code 边界/,
    );

    writeFileSync(
      finalSegment,
      `select '${U6_C2_MIGRATION_VERSION}', '${U6_C2_CHECKSUM_PLACEHOLDER}';\n-- commit;\n`,
    );
    assert.throws(
      () => renderU6C2MigrationCandidateFromSegments(sourceDirectory),
      /冻结 ledger 调用/,
    );

    writeCandidateSources(sourceDirectory);
    const executableFinal = readFileSync(finalSegment, "utf8");
    writeFileSync(
      finalSegment,
      executableFinal.replace(
        finalLedgerBlock(U6_C2_CHECKSUM_PLACEHOLDER),
        `EXPLAIN\n${finalLedgerBlock(U6_C2_CHECKSUM_PLACEHOLDER)}`,
      ),
    );
    assert.throws(
      () => renderU6C2MigrationCandidateFromSegments(sourceDirectory),
      /独立顶层语句/,
    );

    writeCandidateSources(sourceDirectory);
    const earlierSegment = resolve(sourceDirectory, "20-budget-policy-events.sql.inc");
    writeFileSync(
      earlierSegment,
      `${readFileSync(earlierSegment, "utf8")}
SELECT platform.assert_migration_checksum (
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  'forbidden_extra_migration',
  'sha256:${"d".repeat(64)}'
);
`,
    );
    assert.throws(
      () => renderU6C2MigrationCandidateFromSegments(sourceDirectory),
      /必须且只能调用一次 migration ledger/,
    );

    for (const unicodeEscapedIdentifier of [
      String.raw`U&"assert_migration_\0063hecksum"`,
      String.raw`u&"assert_migration_\+000063hecksum"`,
      String.raw`U&"assert_migration_!0063hecksum" UESCAPE '!'`,
    ]) {
      writeCandidateSources(sourceDirectory);
      writeFileSync(
        earlierSegment,
        `${readFileSync(earlierSegment, "utf8")}
select platform.${unicodeEscapedIdentifier}(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  'forbidden_unicode_identifier_migration',
  'sha256:${"d".repeat(64)}'
);
`,
      );
      assert.throws(
        () => renderU6C2MigrationCandidateFromSegments(sourceDirectory),
        /禁止 Unicode escaped identifier/,
      );
    }

    writeCandidateSources(sourceDirectory);
    writeFileSync(
      earlierSegment,
      `${readFileSync(earlierSegment, "utf8")}
do $u6_direct_ledger$
begin
  perform platform.assert_migration_checksum(
    'app',
    '00000000-0000-4000-8000-00000000da01'::uuid,
    'forbidden_do_migration',
    'sha256:${"e".repeat(64)}'
  );
end
$u6_direct_ledger$;
`,
    );
    assert.throws(
      () => renderU6C2MigrationCandidateFromSegments(sourceDirectory),
      /必须且只能调用一次 migration ledger/,
    );

    writeCandidateSources(sourceDirectory);
    writeFileSync(
      earlierSegment,
      `${readFileSync(earlierSegment, "utf8")}
create or replace function app_data_agent.forbidden_ledger()
returns void
language plpgsql
as $u6_function_ledger$
begin
  perform platform.assert_migration_checksum(
    'app',
    '00000000-0000-4000-8000-00000000da01'::uuid,
    'forbidden_function_migration',
    'sha256:${"e".repeat(64)}'
  );
end
$u6_function_ledger$;
`,
    );
    assert.throws(
      () => renderU6C2MigrationCandidateFromSegments(sourceDirectory),
      /必须且只能调用一次 migration ledger/,
    );

    writeCandidateSources(sourceDirectory);
    writeFileSync(
      earlierSegment,
      `${readFileSync(earlierSegment, "utf8")}
do $u6_dynamic_ledger$
begin
  execute 'select platform.assert_migration_' || 'checksum(...)';
end
$u6_dynamic_ledger$;
`,
    );
    assert.throws(
      () => renderU6C2MigrationCandidateFromSegments(sourceDirectory),
      /动态 SQL EXECUTE/,
    );

    writeCandidateSources(sourceDirectory);
    writeFileSync(
      earlierSegment,
      `${readFileSync(earlierSegment, "utf8")}
create or replace function app_data_agent.forbidden_dynamic_ledger()
returns void
language plpgsql
as $u6_dynamic_function_ledger$
begin
  execute 'select platform.assert_migration_' || 'checksum(...)';
end
$u6_dynamic_function_ledger$;
`,
    );
    assert.throws(
      () => renderU6C2MigrationCandidateFromSegments(sourceDirectory),
      /动态 SQL EXECUTE/,
    );

    writeCandidateSources(sourceDirectory);
    writeFileSync(
      earlierSegment,
      `${readFileSync(earlierSegment, "utf8")}
do 'begin perform platform.assert_migration_checksum(
  ''app'',
  ''00000000-0000-4000-8000-00000000da01''::uuid,
  ''forbidden_single_quote_migration'',
  ''sha256:${"f".repeat(64)}''
); end';
`,
    );
    assert.throws(
      () => renderU6C2MigrationCandidateFromSegments(sourceDirectory),
      /必须使用可递归校验的 dollar quote/,
    );

    writeCandidateSources(sourceDirectory);
    writeFileSync(
      earlierSegment,
      `${readFileSync(earlierSegment, "utf8")}
-- SELECT platform.assert_migration_checksum (...);
select 'platform.assert_migration_checksum('::text;
grant execute on function app_data_agent.some_candidate(jsonb) to data_agent_backend;
create trigger some_candidate_trigger
after insert on app_data_agent.some_candidate
for each row
execute function app_data_agent.some_candidate_trigger();
`,
    );
    assert.doesNotThrow(() =>
      renderU6C2MigrationCandidateFromSegments(sourceDirectory),
    );
  });

  test("C2 maintenance manifest 固定独立 protocol、十一表 tuple 与 domain hash", () => {
    const manifest = validateU6C2MaintenanceManifest(readManifest());
    assert.equal(manifest.relation_limits.length, 11);
    assert.equal(manifest.manifest_hash, U6_C2_FROZEN_MANIFEST_HASH);

    const extra = structuredClone(readManifest());
    extra.extra = true;
    assert.throws(() => validateU6C2MaintenanceManifest(extra), /字段不闭合/);

    const reordered = structuredClone(readManifest());
    const reorderedLimits = reordered.relation_limits as unknown[];
    [reorderedLimits[0], reorderedLimits[1]] = [reorderedLimits[1], reorderedLimits[0]];
    assert.throws(
      () => validateU6C2MaintenanceManifest(reordered),
      /冻结 tuple 顺序/,
    );

    const duplicate = structuredClone(readManifest());
    const duplicateLimits = duplicate.relation_limits as Array<Record<string, unknown>>;
    duplicateLimits[1] = structuredClone(duplicateLimits[0] as Record<string, unknown>);
    assert.throws(
      () => validateU6C2MaintenanceManifest(duplicate),
      /冻结 tuple 顺序/,
    );

    const unsafe = structuredClone(readManifest());
    (
      (unsafe.relation_limits as Array<Record<string, unknown>>)[0] as Record<
        string,
        unknown
      >
    ).approved_max_rows = Number.MAX_SAFE_INTEGER + 1;
    assert.throws(() => validateU6C2MaintenanceManifest(unsafe), /SafeInteger/);

    const wrongDomain = structuredClone(readManifest());
    wrongDomain.manifest_hash =
      "sha256:70b5acaf260521a4b8d8581ca2f33dcebbeb6cd826315d3c246cfa80b35f0723";
    assert.throws(() => validateU6C2MaintenanceManifest(wrongDomain), /不匹配/);

    const recomputedDrift = structuredClone(readManifest());
    (recomputedDrift.maintenance_window as Record<string, unknown>).max_duration_ms =
      600_001;
    const withoutHash = structuredClone(recomputedDrift);
    delete withoutHash.manifest_hash;
    recomputedDrift.manifest_hash = sha256(
      `u6-c2-migration-maintenance@1.0.0\0${canonicalJson(withoutHash)}`,
    );
    assert.throws(
      () => validateU6C2MaintenanceManifest(recomputedDrift),
      /committed manifest hash 漂移/,
    );
  });

  test("C2 authoring 前逐字复验 immutable 10590 与 baseline Inventory", () => {
    const baseline = verifyImmutableU6C1Baseline(defaultPaths.c1);
    const verified = verifyU6C2AuthoringInputs(defaultPaths);
    assert.equal(baseline.migration.sha256, U6_C1_FROZEN_MIGRATION_CHECKSUM);
    assert.equal(
      verified.baselineInventory.migration.sha256,
      U6_C1_FROZEN_MIGRATION_CHECKSUM,
    );
    const frozenBaseline = assertFrozenU6C1InventoryProjection(readBaselineInventory());
    assert.equal(
      sha256(
        `u6-schema-inventory@1.0.0\0${canonicalJson(
          frozenBaseline as unknown as Record<string, unknown>,
        )}`,
      ),
      U6_C1_FROZEN_INVENTORY_HASH,
    );

    for (const mutation of [
      (value: Record<string, unknown>) => {
        (value.migration as Record<string, unknown>).name = "forbidden";
      },
      (value: Record<string, unknown>) => {
        (value.migration as Record<string, unknown>).sha256 = unrelatedHash;
      },
      (value: Record<string, unknown>) => {
        (value.migration as Record<string, unknown>).source_segments = [];
      },
    ]) {
      const drifted = structuredClone(readBaselineInventory());
      mutation(drifted);
      assert.throws(() => assertFrozenU6C1InventoryProjection(drifted), /漂移/);
    }

    const missingSurface = structuredClone(readBaselineInventory());
    (missingSurface.relations as unknown[]).splice(0, 1);
    assert.throws(
      () => assertFrozenU6C1InventoryProjection(missingSurface),
      /完整投影漂移/,
    );
  });

  test("candidate Inventory 固定 10590→10600 二元组并显式标记不可安装", () => {
    const baseline = readBaselineInventory();
    const sourceDirectory = resolve(temporaryDirectory("u6-c2-inventory-"), "sources");
    writeCandidateSources(sourceDirectory);
    const rendered = renderU6C2MigrationCandidateFromSegments(sourceDirectory);
    const candidate = buildU6C2CandidateInventory({
      baselineInventory: baseline,
      c2SourceDirectory: sourceDirectory,
      surfaceDelta: emptyU6C2InventorySurfaceDelta(),
    });

    assert.equal(candidate.installable, false);
    assert.equal(candidate.protocol_version, "u6-schema-inventory-candidate@1.0.0");
    assert.equal(candidate.target_protocol_version, "u6-schema-inventory@1.0.0");
    assert.deepEqual(
      candidate.migrations.map(({ name }) => name),
      [
        "20260725010590_app_data_agent_u6_research_authority.sql",
        "20260725010600_app_data_agent_u6_research_derivation.sql",
      ],
    );
    assert.equal(candidate.migrations[0].sha256, U6_C1_FROZEN_MIGRATION_CHECKSUM);
    assert.equal(candidate.migrations[1].sha256, rendered.checksum);
    assert.notEqual(candidate.migrations[1].sha256, U6_C1_FROZEN_MIGRATION_CHECKSUM);
    assert.equal(candidate.baseline_inventory_hash, U6_C1_FROZEN_INVENTORY_HASH);
    assert.throws(
      () => assertFrozenU6C1InventoryProjection(candidate),
      /baseline Inventory protocol 漂移/,
    );
  });

  test("surface delta 先 duplicate-fail，且不允许覆盖 baseline 或未冻结 replacement", () => {
    const baseline = readBaselineInventory();
    const sourceDirectory = resolve(temporaryDirectory("u6-c2-delta-"), "sources");
    writeCandidateSources(sourceDirectory);
    const delta = emptyU6C2InventorySurfaceDelta();
    delta.additions.relation.push(
      {
        identity: "app_data_agent.research_budget_events",
        descriptor: { source_segment: "20-budget-policy-events.sql.inc" },
      },
      {
        identity: "app_data_agent.research_budget_events",
        descriptor: { source_segment: "20-budget-policy-events.sql.inc" },
      },
    );
    assert.throws(
      () =>
        buildU6C2CandidateInventory({
          baselineInventory: baseline,
          c2SourceDirectory: sourceDirectory,
          surfaceDelta: delta,
        }),
      /重复 identity/,
    );

    const collision = emptyU6C2InventorySurfaceDelta();
    collision.additions.relation.push({
      identity: "app_data_agent.research_resource_run_heads",
      descriptor: { forbidden: true },
    });
    assert.throws(
      () =>
        buildU6C2CandidateInventory({
          baselineInventory: baseline,
          c2SourceDirectory: sourceDirectory,
          surfaceDelta: collision,
        }),
      /与 baseline 冲突/,
    );

    const replacement = emptyU6C2InventorySurfaceDelta();
    replacement.replacements.function.push({
      identity: "app_data_agent.commit_research_stop_terminal(jsonb)",
      descriptor: { candidate_body_hash: `sha256:${"c".repeat(64)}` },
    });
    assert.throws(
      () =>
        buildU6C2CandidateInventory({
          baselineInventory: baseline,
          c2SourceDirectory: sourceDirectory,
          surfaceDelta: replacement,
        }),
      /尚未由 physical descriptor 冻结/,
    );

    const driftedBaseline = structuredClone(baseline);
    driftedBaseline.relations = (driftedBaseline.relations as Array<Record<string, unknown>>).filter(
      (relation) =>
        relation.qualified_name !== "app_data_agent.research_resource_run_heads",
    );
    assert.throws(
      () =>
        buildU6C2CandidateInventory({
          baselineInventory: driftedBaseline,
          c2SourceDirectory: sourceDirectory,
          surfaceDelta: collision,
        }),
      /完整投影漂移/,
    );

    assert.ok(Object.isFrozen(U6_C2_INVENTORY_REPLACEMENT_ALLOWLIST));
    for (const entries of Object.values(U6_C2_INVENTORY_REPLACEMENT_ALLOWLIST)) {
      assert.ok(Object.isFrozen(entries));
    }

    const prematureIndex = emptyU6C2InventorySurfaceDelta();
    prematureIndex.additions.index.push({
      identity: "app_data_agent.research_budget_events_idx",
      descriptor: { forbidden_before_descriptor: true },
    });
    assert.throws(
      () =>
        buildU6C2CandidateInventory({
          baselineInventory: baseline,
          c2SourceDirectory: sourceDirectory,
          surfaceDelta: prematureIndex,
        }),
      /index addition 尚未由 physical descriptor 冻结/,
    );
  });

  test("10600 专用 verifier 复验 source bytes，静态门不使用全局 hash 归零", () => {
    const root = temporaryDirectory("u6-c2-generated-");
    const sourceDirectory = resolve(root, "sources");
    const migrationPath = resolve(root, U6_C2_MIGRATION_VERSION.concat(".sql"));
    writeCandidateSources(sourceDirectory);
    const rendered = renderU6C2MigrationCandidateFromSegments(sourceDirectory);
    writeFileSync(migrationPath, rendered.content);

    const verified = verifyU6C2GeneratedMigration({
      ...defaultPaths,
      c2SourceDirectory: sourceDirectory,
      c2MigrationPath: migrationPath,
    });
    assert.equal(verified.checksum, rendered.checksum);

    writeFileSync(migrationPath, rendered.content.replace(unrelatedHash, `sha256:${"c".repeat(64)}`));
    assert.throws(
      () =>
        verifyU6C2GeneratedMigration({
          ...defaultPaths,
          c2SourceDirectory: sourceDirectory,
          c2MigrationPath: migrationPath,
        }),
      /渲染结果不一致/,
    );

    const staticCheck = readFileSync(
      resolve(repositoryRoot, "infra/supabase/test-support/static-check.sh"),
      "utf8",
    );
    assert.match(
      staticCheck,
      /assert-u6-migration-path\.sh[\s\S]*?u6_migration_kind[\s\S]*?render-u6-c2-migration\.ts --verify-generated[\s\S]*?continue/,
    );

    const infraDirectory = resolve(repositoryRoot, "infra/supabase");
    const pathGuard = resolve(
      infraDirectory,
      "test-support/assert-u6-migration-path.sh",
    );
    const validC1 = spawnSync(
      "sh",
      [
        pathGuard,
        infraDirectory,
        resolve(
          infraDirectory,
          "apps/data-agent/migrations/20260725010590_app_data_agent_u6_research_authority.sql",
        ),
      ],
      { encoding: "utf8" },
    );
    assert.equal(validC1.status, 0, validC1.stderr);
    assert.equal(validC1.stdout.trim(), "C1");

    for (const forbiddenName of [
      "20260725010590_app_data_agent_u6_research_authority.sql",
      "20260725010600_app_data_agent_u6_research_derivation.sql",
    ]) {
      const forbidden = spawnSync(
        "sh",
        [
          pathGuard,
          infraDirectory,
          resolve(infraDirectory, "platform/migrations", forbiddenName),
        ],
        { encoding: "utf8" },
      );
      assert.notEqual(forbidden.status, 0);
      assert.match(forbidden.stderr, /forbidden outside the app data-agent chain/);
    }
  });

  test("10590 CLI 默认路径只 verify，运行前后 migration 与 Inventory bytes 不变", () => {
    const migrationBefore = readFileSync(defaultPaths.c1.migrationPath);
    const inventoryBefore = readFileSync(defaultPaths.c1.inventoryPath);
    const result = spawnSync(
      "pnpm",
      ["exec", "tsx", "scripts/render-u6-migration.ts"],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /immutable 10590 artifacts verified/);
    assert.deepEqual(readFileSync(defaultPaths.c1.migrationPath), migrationBefore);
    assert.deepEqual(readFileSync(defaultPaths.c1.inventoryPath), inventoryBefore);
  });
});
