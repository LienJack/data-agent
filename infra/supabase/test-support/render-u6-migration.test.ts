import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  renderMigrationFromSegments,
  renderU6Migration,
  U6_BACKEND_EXECUTE_ENABLED_FUNCTIONS,
  U6_CHECKSUM_PLACEHOLDER,
  U6_EXPECTED_FUNCTIONS,
  U6_MIGRATION_NAME,
  U6_MIGRATION_VERSION,
  U6_SOURCE_SEGMENTS,
  U6_ZERO_CHECKSUM,
  verifyGeneratedArtifacts,
  type U6RendererPaths,
} from "../../../scripts/render-u6-migration.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryRendererPaths(): U6RendererPaths {
  const root = mkdtempSync(resolve(tmpdir(), "u6-renderer-"));
  temporaryDirectories.push(root);
  return {
    sourceDirectory: resolve(root, "sources"),
    migrationPath: resolve(root, "migrations", U6_MIGRATION_NAME),
    inventoryPath: resolve(root, "u6-schema-inventory.json"),
    maintenanceManifestPath: resolve(root, "u6-migration-maintenance-manifest.json"),
  };
}

function executable(path: string, source: string): void {
  writeFileSync(path, source);
  chmodSync(path, 0o700);
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

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function sqlTextArray(source: string, constantName: string): string[] {
  const escapedName = constantName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [
    ...source.matchAll(
      new RegExp(
        `\\b${escapedName}\\s+constant\\s+text\\[\\]\\s*:=\\s*array\\[([\\s\\S]*?)\\]\\s*;`,
        "g",
      ),
    ),
  ];
  assert.equal(matches.length, 1, `${constantName} 必须且只能声明一次`);
  return [...(matches[0]?.[1] ?? "").matchAll(/'([^']+)'/g)].map(
    (match) => match[1] ?? "",
  );
}

function writeManifest(path: string, corruptHash = false): void {
  const manifestWithoutHash = {
    protocol_version: "u6-migration-maintenance@1.0.0",
    migration_name: U6_MIGRATION_NAME,
    deployment_scope: {
      app_id: "00000000-0000-4000-8000-00000000da01",
      deployment_binding: "SESSION_ACTIVE_MAPPING",
      database_binding: "SESSION_DATABASE_IDENTITY",
    },
    maintenance_window: {
      window_id: "00000000-0000-4000-8000-000000001590",
      max_duration_ms: 600_000,
    },
    timeouts: {
      lock_timeout_ms: 2_000,
      statement_timeout_ms: 300_000,
      idle_in_transaction_session_timeout_ms: 60_000,
    },
    relation_limits: [
      "app_data_agent.artifacts",
      "app_data_agent.memberships",
      "app_data_agent.outbox",
      "app_data_agent.run_attempts",
      "app_data_agent.runs",
      "platform.app_environment_lifecycle",
      "platform.deployment_mappings",
    ].map((qualifiedName) => ({
      qualified_name: qualifiedName,
      approved_max_rows: 1_000_000,
      approved_max_total_bytes: 1_073_741_824,
    })),
  };
  const manifestHash = sha256(
    `u6-migration-maintenance@1.0.0\0${canonicalJson(manifestWithoutHash)}`,
  );
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        ...manifestWithoutHash,
        manifest_hash: corruptHash ? `sha256:${"f".repeat(64)}` : manifestHash,
      },
      null,
      2,
    )}\n`,
  );
}

function functionSql(
  schema: "app_data_agent" | "platform",
  functionSignature: string,
): string {
  const open = functionSignature.indexOf("(");
  const name = functionSignature.slice(0, open);
  const argumentTypes = functionSignature.slice(open + 1, -1);
  const argumentsSql =
    argumentTypes === ""
      ? ""
      : argumentTypes
          .split(",")
          .map((type, index) => `requested_${index + 1} ${type}`)
          .join(", ");
  const owner =
    schema === "platform"
      ? "data_agent_u6_platform_lock_owner"
      : U6_EXPECTED_FUNCTIONS.deployment.includes(functionSignature as never)
        ? "data_agent_u6_provisioner_owner"
        : U6_EXPECTED_FUNCTIONS.jobCleanup.includes(functionSignature as never)
          ? "data_agent_u6_cleanup_owner"
          : "data_agent_u6_rpc_owner";
  const internal = U6_EXPECTED_FUNCTIONS.internal.find(
    (item) => item.signature === functionSignature,
  );
  const language = internal?.language ?? "plpgsql";
  const volatility = internal?.volatility.toLowerCase() ?? "volatile";
  const nullInput =
    internal?.null_input === "STRICT" ? "strict" : "called on null input";
  const security = internal?.security_definer === false ? "" : "security definer";
  return `
create or replace function ${schema}.${name}(${argumentsSql})
returns jsonb
language ${language}
${volatility}
${nullInput}
${security}
set search_path = ''
as $$
begin
  return '{}'::jsonb;
end
$$;
alter function ${schema}.${name}(${argumentTypes}) owner to ${owner};
`;
}

function allFunctionSql(): string {
  const appSignatures = [
    ...U6_EXPECTED_FUNCTIONS.publicMutation,
    ...U6_EXPECTED_FUNCTIONS.publicResolver,
    ...U6_EXPECTED_FUNCTIONS.deployment,
    ...U6_EXPECTED_FUNCTIONS.jobCleanup,
    ...U6_EXPECTED_FUNCTIONS.internal.map((item) => item.signature),
  ];
  return [
    ...appSignatures.map((item) => functionSql("app_data_agent", item)),
    ...U6_EXPECTED_FUNCTIONS.platformHelper.map((item) => functionSql("platform", item)),
    `
create function platform.u6_lifecycle_identity_immutable_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  return new;
end
$$;
revoke all privileges on function platform.u6_lifecycle_identity_immutable_guard() from public;
`,
  ].join("\n");
}

type CompleteSourceOptions = {
  omitFunctionAcl?: boolean;
  omitBackendRevoke?: boolean;
  extraWithheldBackendGrant?: boolean;
};

function sqlStringList(values: readonly string[]): string {
  return values.map((value) => `    '${value}'`).join(",\n");
}

function functionAclSql(options: CompleteSourceOptions): string {
  const publicNames = [
    ...U6_EXPECTED_FUNCTIONS.publicMutation,
    ...U6_EXPECTED_FUNCTIONS.publicResolver,
  ].map((item) => item.slice(0, item.indexOf("(")));
  const enabledNames = U6_BACKEND_EXECUTE_ENABLED_FUNCTIONS.map((item) =>
    item.slice(0, item.indexOf("(")),
  );
  const revoke = options.omitBackendRevoke
    ? ""
    : `    execute pg_catalog.format(
      'revoke all privileges on function app_data_agent.%I(jsonb) from public, anon, authenticated, service_role, data_agent_backend, data_agent_job_authority, data_agent_u6_provisioner',
      function_name
    );
`;
  const extraGrant = options.extraWithheldBackendGrant
    ? `
grant execute on function app_data_agent.initialize_research_version_frontier(jsonb)
to data_agent_backend;
`
    : "";
  return `
do $u6_function_ownership_and_acl$
declare
  function_name text;
  public_functions constant text[] := array[
${sqlStringList(publicNames)}
  ];
  backend_enabled_functions constant text[] := array[
${sqlStringList(enabledNames)}
  ];
begin
  foreach function_name in array public_functions
  loop
${revoke}    if function_name = any(backend_enabled_functions) then
      execute pg_catalog.format(
        'grant execute on function app_data_agent.%I(jsonb) to data_agent_backend',
        function_name
      );
    end if;
  end loop;
end
$u6_function_ownership_and_acl$;
${extraGrant}`;
}

function functionAclPostconditionsSql(): string {
  const publicSignatures = [
    ...U6_EXPECTED_FUNCTIONS.publicMutation,
    ...U6_EXPECTED_FUNCTIONS.publicResolver,
  ].map((item) => `app_data_agent.${item}`);
  const enabledSignatures = U6_BACKEND_EXECUTE_ENABLED_FUNCTIONS.map(
    (item) => `app_data_agent.${item}`,
  );
  const withheldSignatures = publicSignatures.filter(
    (item) => !enabledSignatures.includes(item as never),
  );
  return `
do $u6_catalog_postconditions$
declare
  function_signature text;
  backend_enabled_function_signatures constant text[] := array[
${sqlStringList(enabledSignatures)}
  ];
  backend_withheld_function_signatures constant text[] := array[
${sqlStringList(withheldSignatures)}
  ];
begin
  foreach function_signature in array backend_enabled_function_signatures
  loop
    if not pg_catalog.has_function_privilege(
      'data_agent_backend',
      function_signature,
      'EXECUTE'
    ) or pg_catalog.has_function_privilege(
      'public',
      function_signature,
      'EXECUTE'
    ) then
      raise exception using message = 'U6_MIGRATION_BACKEND_FUNCTION_ACL_MISMATCH';
    end if;
  end loop;
  foreach function_signature in array backend_withheld_function_signatures
  loop
    if pg_catalog.has_function_privilege(
      'data_agent_backend',
      function_signature,
      'EXECUTE'
    ) or pg_catalog.has_function_privilege(
      'public',
      function_signature,
      'EXECUTE'
    ) then
      raise exception using message = 'U6_MIGRATION_WITHHELD_FUNCTION_ACL_MISMATCH';
    end if;
  end loop;
end
$u6_catalog_postconditions$;
`;
}

function writeCompleteSources(
  paths: U6RendererPaths,
  options: CompleteSourceOptions = {},
): void {
  mkdirSync(paths.sourceDirectory, { recursive: true });
  for (const segment of U6_SOURCE_SEGMENTS) {
    let content = `-- ${segment}\n`;
    if (segment === "80-internal-functions.sql.inc") {
      content += allFunctionSql();
      content += `select 'sha256:${"1".repeat(64)}'::text;\n`;
    }
    if (segment === "90-rls-owner-grants.sql.inc" && !options.omitFunctionAcl) {
      content += functionAclSql(options);
    }
    if (segment === "99-postconditions-commit.sql.inc") {
      content += `${functionAclPostconditionsSql()}
select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '${U6_MIGRATION_VERSION}',
  '${U6_CHECKSUM_PLACEHOLDER}'
);
commit;
`;
    }
    writeFileSync(resolve(paths.sourceDirectory, segment), content);
  }
}

describe("U6 deterministic migration renderer", () => {
  test("固定分段渲染结果稳定，且仅归一化 marker 与对应 ledger checksum", () => {
    const paths = temporaryRendererPaths();
    writeCompleteSources(paths);

    const first = renderMigrationFromSegments(paths.sourceDirectory);
    const second = renderMigrationFromSegments(paths.sourceDirectory);

    assert.deepEqual(first, second);
    assert.match(first.content, /^-- u6_migration_checksum: sha256:[0-9a-f]{64}$/m);
    assert.ok(first.content.includes(`sha256:${"1".repeat(64)}`));
    const normalized = first.content
      .replace(
        /^-- u6_migration_checksum: sha256:[0-9a-f]{64}$/m,
        `-- u6_migration_checksum: ${U6_ZERO_CHECKSUM}`,
      )
      .replace(
        new RegExp(
          `('${U6_MIGRATION_VERSION}'\\s*,\\s*')sha256:[0-9a-f]{64}(')`,
        ),
        `$1${U6_ZERO_CHECKSUM}$2`,
      );
    assert.equal(sha256(normalized), first.checksum);
  });

  test("完整渲染原子生成 migration 与 Inventory，并可独立复验", () => {
    const paths = temporaryRendererPaths();
    writeCompleteSources(paths);
    writeManifest(paths.maintenanceManifestPath);

    renderU6Migration(paths);
    verifyGeneratedArtifacts(paths);

    const migration = readFileSync(paths.migrationPath, "utf8");
    const inventory = JSON.parse(readFileSync(paths.inventoryPath, "utf8")) as {
      migration: { sha256: string; source_segments: string[] };
      relations: Array<{ cleanup_owner: string }>;
      functions: Array<{
        schema: string;
        signature: string;
        exposure: string;
        backend_execute_enabled: boolean;
      }>;
    };
    const marker = migration.match(
      /^-- u6_migration_checksum: (sha256:[0-9a-f]{64})$/m,
    )?.[1];
    assert.equal(inventory.migration.sha256, marker);
    assert.deepEqual(inventory.migration.source_segments, U6_SOURCE_SEGMENTS);
    assert.equal(
      inventory.relations.filter((item) => item.cleanup_owner === "U6_JOB").length,
      41,
    );
    assert.equal(
      inventory.relations.filter((item) => item.cleanup_owner === "RETAINED_CONTROL")
        .length,
      2,
    );
    assert.equal(
      inventory.functions.filter((item) => item.exposure === "INTERNAL").length,
      7,
    );
    assert.ok(
      inventory.functions.every(
        (item) => typeof item.backend_execute_enabled === "boolean",
      ),
    );
    assert.deepEqual(
      inventory.functions
        .filter((item) => item.backend_execute_enabled)
        .map((item) => item.signature)
        .sort(),
      [...U6_BACKEND_EXECUTE_ENABLED_FUNCTIONS].sort(),
    );
  });

  test("Backend EXECUTE 激活门在 renderer、ACL 与 postcondition 中保持同一闭集", () => {
    const testSupportDirectory = resolve(fileURLToPath(import.meta.url), "..");
    const sourceRoot = resolve(
      testSupportDirectory,
      "../apps/data-agent/migration-sources/10590",
    );
    const grantsSource = readFileSync(
      resolve(sourceRoot, "90-rls-owner-grants.sql.inc"),
      "utf8",
    );
    const postconditionsSource = readFileSync(
      resolve(sourceRoot, "99-postconditions-commit.sql.inc"),
      "utf8",
    );
    const allPublicSignatures = [
      ...U6_EXPECTED_FUNCTIONS.publicMutation,
      ...U6_EXPECTED_FUNCTIONS.publicResolver,
    ];
    const expectedEnabledNames = U6_BACKEND_EXECUTE_ENABLED_FUNCTIONS.map((item) =>
      item.slice(0, item.indexOf("(")),
    );
    const expectedWithheldSignatures = allPublicSignatures
      .filter(
        (item) =>
          !U6_BACKEND_EXECUTE_ENABLED_FUNCTIONS.includes(item as never),
      )
      .map((item) => `app_data_agent.${item}`);

    assert.deepEqual(
      sqlTextArray(grantsSource, "public_functions").sort(),
      allPublicSignatures
        .map((item) => item.slice(0, item.indexOf("(")))
        .sort(),
    );
    assert.deepEqual(
      sqlTextArray(grantsSource, "backend_enabled_functions").sort(),
      [...expectedEnabledNames].sort(),
    );
    assert.match(
      grantsSource,
      /foreach function_name in array public_functions[\s\S]*?'revoke all privileges on function app_data_agent\.%I\(jsonb\) from [^']*data_agent_backend[^']*'[\s\S]*?if function_name = any\(backend_enabled_functions\) then[\s\S]*?'grant execute on function app_data_agent\.%I\(jsonb\) to data_agent_backend'[\s\S]*?end if;[\s\S]*?end loop;/,
    );
    assert.deepEqual(
      sqlTextArray(
        postconditionsSource,
        "backend_enabled_function_signatures",
      ).sort(),
      U6_BACKEND_EXECUTE_ENABLED_FUNCTIONS.map(
        (item) => `app_data_agent.${item}`,
      ).sort(),
    );
    assert.deepEqual(
      sqlTextArray(
        postconditionsSource,
        "backend_withheld_function_signatures",
      ).sort(),
      expectedWithheldSignatures.sort(),
    );
    assert.match(
      postconditionsSource,
      /foreach function_signature in array backend_withheld_function_signatures[\s\S]*?has_function_privilege\([\s\S]*?'data_agent_backend'[\s\S]*?'EXECUTE'[\s\S]*?U6_MIGRATION_WITHHELD_FUNCTION_ACL_MISMATCH/,
    );
  });

  test("Inventory 中篡改 withheld RPC 的 Backend EXECUTE 标记会复验失败", () => {
    const paths = temporaryRendererPaths();
    writeCompleteSources(paths);
    writeManifest(paths.maintenanceManifestPath);
    renderU6Migration(paths);
    const inventory = JSON.parse(readFileSync(paths.inventoryPath, "utf8")) as {
      functions: Array<{
        signature: string;
        backend_execute_enabled: boolean;
      }>;
    };
    const withheld = inventory.functions.find(
      (item) =>
        !U6_BACKEND_EXECUTE_ENABLED_FUNCTIONS.includes(item.signature as never),
    );
    assert.ok(withheld);
    withheld.backend_execute_enabled = true;
    writeFileSync(paths.inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);

    assert.throws(
      () => verifyGeneratedArtifacts(paths),
      /Schema Inventory 与 renderer 投影不一致/,
    );
  });

  test("缺少 public/backend Function ACL 时 renderer 失败关闭", () => {
    const paths = temporaryRendererPaths();
    writeCompleteSources(paths, { omitFunctionAcl: true });
    writeManifest(paths.maintenanceManifestPath);

    assert.throws(() => renderU6Migration(paths), /Backend EXECUTE ACL/);
    assert.equal(existsSync(paths.migrationPath), false);
    assert.equal(existsSync(paths.inventoryPath), false);
  });

  test("public Function ACL 缺少 Backend REVOKE 时 renderer 失败关闭", () => {
    const paths = temporaryRendererPaths();
    writeCompleteSources(paths, { omitBackendRevoke: true });
    writeManifest(paths.maintenanceManifestPath);

    assert.throws(() => renderU6Migration(paths), /Backend EXECUTE ACL/);
    assert.equal(existsSync(paths.migrationPath), false);
    assert.equal(existsSync(paths.inventoryPath), false);
  });

  test("withheld RPC 获得额外 Backend GRANT 时 renderer 失败关闭", () => {
    const paths = temporaryRendererPaths();
    writeCompleteSources(paths, { extraWithheldBackendGrant: true });
    writeManifest(paths.maintenanceManifestPath);

    assert.throws(() => renderU6Migration(paths), /Backend EXECUTE ACL/);
    assert.equal(existsSync(paths.migrationPath), false);
    assert.equal(existsSync(paths.inventoryPath), false);
  });

  test("maintenance runner 在调用任何工具前拒绝外部同名 migration", () => {
    const root = mkdtempSync(resolve(tmpdir(), "u6-runner-external-"));
    temporaryDirectories.push(root);
    const fakeBin = resolve(root, "bin");
    const externalDirectory = resolve(root, "external");
    const externalMigration = resolve(externalDirectory, U6_MIGRATION_NAME);
    const pnpmProbe = resolve(root, "pnpm-called");
    mkdirSync(fakeBin, { recursive: true });
    mkdirSync(externalDirectory, { recursive: true });
    writeFileSync(
      externalMigration,
      `-- u6_migration_checksum: sha256:${"a".repeat(64)}\n`,
    );
    executable(
      resolve(fakeBin, "pnpm"),
      `#!/bin/sh\n: > "$U6_PNPM_PROBE"\nexit 0\n`,
    );
    executable(resolve(fakeBin, "docker"), "#!/bin/sh\nexit 99\n");
    const runner = resolve(
      fileURLToPath(import.meta.url),
      "../run-u6-maintenance-migration.sh",
    );

    const result = spawnSync(
      "/bin/sh",
      [
        runner,
        "unused-container",
        "unused-database",
        externalMigration,
        "00000000-0000-4000-8000-00000000de01",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
          U6_PNPM_PROBE: pnpmProbe,
        },
      },
    );

    assert.equal(result.status, 2);
    assert.match(result.stderr, /canonical generated migration/);
    assert.equal(existsSync(pnpmProbe), false);
  });

  test("maintenance runner 的 migration producer 失败不能被成功的 psql 消费端掩盖", () => {
    const root = mkdtempSync(resolve(tmpdir(), "u6-runner-producer-"));
    temporaryDirectories.push(root);
    const fakeBin = resolve(root, "bin");
    const supportDirectory = resolve(root, "infra/supabase/test-support");
    const appInfraDirectory = resolve(root, "infra/supabase/apps/data-agent");
    const migrationDirectory = resolve(appInfraDirectory, "migrations");
    const scriptsDirectory = resolve(root, "scripts");
    const runner = resolve(supportDirectory, "run-u6-maintenance-migration.sh");
    const canonicalMigration = resolve(migrationDirectory, U6_MIGRATION_NAME);
    const dockerCalls = resolve(root, "docker-calls");
    const runnerTmp = resolve(root, "runner-tmp");
    mkdirSync(fakeBin, { recursive: true });
    mkdirSync(supportDirectory, { recursive: true });
    mkdirSync(migrationDirectory, { recursive: true });
    mkdirSync(scriptsDirectory, { recursive: true });
    mkdirSync(runnerTmp, { recursive: true });
    copyFileSync(
      resolve(fileURLToPath(import.meta.url), "../run-u6-maintenance-migration.sh"),
      runner,
    );
    writeManifest(resolve(appInfraDirectory, "u6-migration-maintenance-manifest.json"));
    writeFileSync(
      canonicalMigration,
      `-- u6_migration_checksum: sha256:${"b".repeat(64)}\n`,
    );
    executable(resolve(fakeBin, "pnpm"), "#!/bin/sh\nexit 0\n");
    executable(
      resolve(fakeBin, "docker"),
      `#!/bin/sh
calls=0
if [ -f "$U6_DOCKER_CALLS" ]; then
  calls=$(cat "$U6_DOCKER_CALLS")
fi
calls=$((calls + 1))
printf '%s' "$calls" > "$U6_DOCKER_CALLS"
if [ "$calls" -eq 1 ]; then
  rm -f "$U6_CANONICAL_MIGRATION"
  find "$U6_RUNNER_TMP" -type f -name '${U6_MIGRATION_NAME}' -delete
  printf '0:\\n'
  exit 0
fi
cat >/dev/null
exit 0
`,
    );

    const result = spawnSync(
      "/bin/sh",
      [
        runner,
        "fake-container",
        "fake-database",
        canonicalMigration,
        "00000000-0000-4000-8000-00000000de01",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
          TMPDIR: runnerTmp,
          U6_CANONICAL_MIGRATION: canonicalMigration,
          U6_DOCKER_CALLS: dockerCalls,
          U6_RUNNER_TMP: runnerTmp,
        },
      },
    );

    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(dockerCalls, "utf8"), "1");
  });

  test("实际动态 policy 名称受 63 字节边界保护且不依赖静默截断", () => {
    const testSupportDirectory = resolve(fileURLToPath(import.meta.url), "..");
    const source = readFileSync(
      resolve(
        testSupportDirectory,
        "../apps/data-agent/migration-sources/10590/90-rls-owner-grants.sql.inc",
      ),
      "utf8",
    );

    assert.ok(source.includes("relation_name || '_u6_rpc'"));
    assert.ok(source.includes("relation_name || '_u6_cleanup'"));
    assert.ok(source.includes("relation_name || '_u6_provision'"));
    assert.ok(source.includes("U6_MIGRATION_POLICY_IDENTIFIER_TOO_LONG"));
    assert.ok(
      !source.includes("relation_name || '_u6_rpc_scope'"),
      "动态 RPC policy 名称不得依赖 PostgreSQL 静默截断",
    );
    assert.ok(
      !source.includes("relation_name || '_u6_cleanup_scope'"),
      "动态 cleanup policy 名称不得依赖 PostgreSQL 静默截断",
    );
    assert.ok(
      !source.includes("relation_name || '_u6_provision_scope'"),
      "动态 provision policy 名称不得依赖 PostgreSQL 静默截断",
    );
  });

  test("缺失或多余 segment 时失败，且不生成部分产物", () => {
    const paths = temporaryRendererPaths();
    writeCompleteSources(paths);
    writeManifest(paths.maintenanceManifestPath);
    rmSync(resolve(paths.sourceDirectory, U6_SOURCE_SEGMENTS[3]));

    assert.throws(() => renderU6Migration(paths), /source segment 闭集不匹配/);
    assert.equal(existsSync(paths.migrationPath), false);
    assert.equal(existsSync(paths.inventoryPath), false);

    writeFileSync(resolve(paths.sourceDirectory, "30-artifact-authority.sql.inc"), "-- restored\n");
    writeFileSync(resolve(paths.sourceDirectory, "85-extra.sql.inc"), "-- forbidden\n");
    assert.throws(() => renderU6Migration(paths), /source segment 闭集不匹配/);
    assert.equal(existsSync(paths.migrationPath), false);
  });

  test("placeholder 不在最终 ledger 参数或出现多次时失败", () => {
    const paths = temporaryRendererPaths();
    writeCompleteSources(paths);
    const postconditions = resolve(
      paths.sourceDirectory,
      "99-postconditions-commit.sql.inc",
    );
    writeFileSync(postconditions, `select '${U6_CHECKSUM_PLACEHOLDER}';\n`);
    assert.throws(
      () => renderMigrationFromSegments(paths.sourceDirectory),
      /必须是最终 migration ledger 参数/,
    );
    writeFileSync(
      postconditions,
      `select '${U6_CHECKSUM_PLACEHOLDER}', '${U6_CHECKSUM_PLACEHOLDER}';\n`,
    );
    assert.throws(
      () => renderMigrationFromSegments(paths.sourceDirectory),
      /必须且只能出现一次/,
    );
  });

  test("maintenance manifest hash 漂移时在写文件前失败", () => {
    const paths = temporaryRendererPaths();
    writeCompleteSources(paths);
    writeManifest(paths.maintenanceManifestPath, true);

    assert.throws(() => renderU6Migration(paths), /manifest_hash 不匹配/);
    assert.equal(existsSync(paths.migrationPath), false);
    assert.equal(existsSync(paths.inventoryPath), false);
  });

  test("非 trigger 的额外函数使 Function Manifest 失败关闭", () => {
    const paths = temporaryRendererPaths();
    writeCompleteSources(paths);
    writeManifest(paths.maintenanceManifestPath);
    const internalSegment = resolve(
      paths.sourceDirectory,
      "80-internal-functions.sql.inc",
    );
    writeFileSync(
      internalSegment,
      `${readFileSync(internalSegment, "utf8")}${functionSql(
        "app_data_agent",
        "unregistered_u6_helper(jsonb)",
      )}`,
    );

    assert.throws(() => renderU6Migration(paths), /未登记的非 trigger 函数/);
    assert.equal(existsSync(paths.migrationPath), false);
    assert.equal(existsSync(paths.inventoryPath), false);
  });

  test("孤儿 ALTER FUNCTION OWNER 使 Function Manifest 失败关闭", () => {
    const paths = temporaryRendererPaths();
    writeCompleteSources(paths);
    writeManifest(paths.maintenanceManifestPath);
    const internalSegment = resolve(
      paths.sourceDirectory,
      "80-internal-functions.sql.inc",
    );
    writeFileSync(
      internalSegment,
      `${readFileSync(
        internalSegment,
        "utf8",
      )}\nalter function app_data_agent.orphan_u6_helper(jsonb) owner to data_agent_u6_rpc_owner;\n`,
    );

    assert.throws(() => renderU6Migration(paths), /ALTER FUNCTION OWNER 闭集漂移/);
    assert.equal(existsSync(paths.migrationPath), false);
    assert.equal(existsSync(paths.inventoryPath), false);
  });

  test("internal helper 属性漂移使 exact Function Manifest 失败关闭", () => {
    const paths = temporaryRendererPaths();
    writeCompleteSources(paths);
    writeManifest(paths.maintenanceManifestPath);
    const internalSegment = resolve(
      paths.sourceDirectory,
      "80-internal-functions.sql.inc",
    );
    const source = readFileSync(internalSegment, "utf8");
    writeFileSync(
      internalSegment,
      source.replace(
        "create or replace function app_data_agent.u6_domain_sha256",
        "create or replace function app_data_agent.u6_domain_sha256",
      ).replace(
        /create or replace function app_data_agent\.u6_domain_sha256([\s\S]*?)\nimmutable\nstrict\n/,
        "create or replace function app_data_agent.u6_domain_sha256$1\nstable\nstrict\n",
      ),
    );

    assert.throws(() => renderU6Migration(paths), /internal function exact manifest 漂移/);
    assert.equal(existsSync(paths.migrationPath), false);
    assert.equal(existsSync(paths.inventoryPath), false);
  });
});
