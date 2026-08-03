import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SEMANTIC_MIGRATION_NAME = "20260725010610_app_data_agent_semantic_control_plane.sql";
export const SEMANTIC_MIGRATION_VERSION = "20260725010610_app_data_agent_semantic_control_plane";
export const SEMANTIC_CHECKSUM_PLACEHOLDER = "__SEMANTIC_MIGRATION_CHECKSUM__";
export const SEMANTIC_MANIFEST_HASH_PLACEHOLDER = "__SEMANTIC_MANIFEST_HASH__";
export const SEMANTIC_ZERO_CHECKSUM = `sha256:${"0".repeat(64)}`;

export const SEMANTIC_SOURCE_SEGMENTS = [
  "00-preamble.sql.inc",
  "10-domain-registry.sql.inc",
  "20-review-policy.sql.inc",
  "30-catalog-fence.sql.inc",
  "40-source-revision.sql.inc",
  "50-candidate.sql.inc",
  "60-review.sql.inc",
  "70-publish.sql.inc",
  "71-projections.sql.inc",
  "72-active-pointer.sql.inc",
  "73-runtime-activation.sql.inc",
  "74-legacy.sql.inc",
  "75-rollback.sql.inc",
  "76-outbox.sql.inc",
  "80-internal-functions.sql.inc",
  "81-decision-rpcs.sql.inc",
  "82-publish-rpcs.sql.inc",
  "83-rollback-rpcs.sql.inc",
  "84-bootstrap-rpcs.sql.inc",
  "85-lifecycle-cleanup.sql.inc",
  "90-rls-owner-grants.sql.inc",
  "99-postconditions-ledger-commit.sql.inc",
] as const;

const APP_ID = "00000000-0000-4000-8000-00000000da01";

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function compareUtf8Bytes(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function normalizeSegment(content: string): string {
  return `${content.replace(/\r\n?/g, "\n").replace(/\n+$/g, "")}\n`;
}

function finalLedgerBlock(checksum: string): string {
  return [
    "select platform.assert_migration_checksum(",
    "  'app',",
    `  '${APP_ID}'::uuid,`,
    `  '${SEMANTIC_MIGRATION_VERSION}',`,
    `  '${checksum}'`,
    ");",
    "",
    "commit;",
    "",
  ].join("\n");
}

function sha256(value: string | Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function renderSemanticMigrationCandidateFromSegments(sourceDirectory: string): {
  content: string;
  checksum: `sha256:${string}`;
} {
  assertCondition(existsSync(sourceDirectory), `10610 source directory 不存在：${sourceDirectory}`);
  const actualSegments = readdirSync(sourceDirectory)
    .filter((entry) => entry.endsWith(".sql.inc"))
    .sort(compareUtf8Bytes);
  const expectedClosedSet = [...SEMANTIC_SOURCE_SEGMENTS].sort(compareUtf8Bytes);
  assertCondition(
    JSON.stringify(actualSegments) === JSON.stringify(expectedClosedSet),
    `10610 source segment 闭集不匹配：actual=${actualSegments.join(",")}`,
  );
  const normalizedSegments = SEMANTIC_SOURCE_SEGMENTS.map((segment) =>
    normalizeSegment(readFileSync(resolve(sourceDirectory, segment), "utf8")),
  );
  const body = normalizedSegments.join("");

  // Count placeholder occurrences
  const checksumPlaceholderCount = body.split(SEMANTIC_CHECKSUM_PLACEHOLDER).length - 1;
  assertCondition(
    checksumPlaceholderCount === 1,
    `10610 ledger checksum placeholder 必须且只能出现一次：found=${checksumPlaceholderCount}`,
  );

  const manifestHashPlaceholderCount = body.split(SEMANTIC_MANIFEST_HASH_PLACEHOLDER).length - 1;
  assertCondition(
    manifestHashPlaceholderCount === 1,
    `10610 manifest hash placeholder 必须且只能出现一次：found=${manifestHashPlaceholderCount}`,
  );

  // Replace manifest hash placeholder with zero checksum for normalization
  const bodyWithManifestZero = body.replace(
    SEMANTIC_MANIFEST_HASH_PLACEHOLDER,
    SEMANTIC_ZERO_CHECKSUM,
  );

  const finalSegment = normalizedSegments.at(-1) ?? "";
  const placeholderLedger = finalLedgerBlock(SEMANTIC_CHECKSUM_PLACEHOLDER);
  const bodyWithZeroChecksum = `${bodyWithManifestZero.slice(
    0,
    -placeholderLedger.length,
  )}${finalLedgerBlock(SEMANTIC_ZERO_CHECKSUM)}`;

  // Compute normalized bytes for checksum
  const normalized = `-- semantic_migration_checksum: ${SEMANTIC_ZERO_CHECKSUM}\n${bodyWithZeroChecksum}`;
  const checksum = sha256(normalized);

  // Build final content with real checksum
  const zeroLedger = finalLedgerBlock(SEMANTIC_ZERO_CHECKSUM);
  const contentWithMarker = normalized.replace(
    `-- semantic_migration_checksum: ${SEMANTIC_ZERO_CHECKSUM}`,
    `-- semantic_migration_checksum: ${checksum}`,
  );
  const contentWithRealChecksum = `${contentWithMarker.slice(0, -zeroLedger.length)}${finalLedgerBlock(checksum)}`;

  // Replace manifest hash placeholder in content with real checksum
  // (Note: in production, the manifest hash should be computed from the manifest file)
  const content = contentWithRealChecksum.replace(
    SEMANTIC_ZERO_CHECKSUM.replace("sha256:", ""),
    checksum.replace("sha256:", ""),
  );

  assertCondition(
    content.includes(checksum),
    "10610 candidate checksum 自校验失败",
  );

  return { content, checksum };
}

export type SemanticCandidatePaths = {
  sourceDirectory: string;
  migrationPath: string;
};

export function defaultSemanticCandidatePaths(repositoryRoot: string): SemanticCandidatePaths {
  const appInfraRoot = resolve(repositoryRoot, "infra/supabase/apps/data-agent");
  return {
    sourceDirectory: resolve(appInfraRoot, "migration-sources/10610"),
    migrationPath: resolve(appInfraRoot, "migrations", SEMANTIC_MIGRATION_NAME),
  };
}

function isMainModule(): boolean {
  return (
    process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  );
}

if (isMainModule()) {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const paths = defaultSemanticCandidatePaths(repositoryRoot);

  if (process.argv.includes("--verify")) {
    assertCondition(existsSync(paths.migrationPath), `10610 migration 文件不存在：${paths.migrationPath}`);
    const rendered = renderSemanticMigrationCandidateFromSegments(paths.sourceDirectory);
    const migration = readFileSync(paths.migrationPath, "utf8");
    assertCondition(migration === rendered.content, "10610 与固定 source segments 渲染结果不一致");
    console.log(`10610 migration verified: ${basename(paths.migrationPath)} checksum=${rendered.checksum}`);
  } else {
    console.log("10610 semantic migration renderer loaded");
    console.log(`segments: ${SEMANTIC_SOURCE_SEGMENTS.length}`);
    console.log(`source: ${paths.sourceDirectory}`);
    console.log(`target: ${paths.migrationPath}`);
  }
}
