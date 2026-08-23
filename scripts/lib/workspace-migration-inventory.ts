import { createHash } from "node:crypto";

const ZERO_CHECKSUM = `sha256:${"0".repeat(64)}`;
const migrationFilePattern = /^(\d{14})_([a-z0-9_]+)\.sql$/;
const checksumHeaderPattern = /^-- [a-z0-9_]+_migration_checksum: (sha256:[0-9a-f]{64})$/m;
const ledgerAssertionPattern =
  /platform\.assert_migration_checksum\([\s\S]*?'(\d{14}_[a-z0-9_]+)'\s*,\s*'(sha256:[0-9a-f]{64})'\s*\)/g;

export const GRANDFATHERED_DUPLICATE_SEQUENCES: Readonly<Record<string, readonly string[]>> = {
  "20260725010673": [
    "20260725010673_app_data_agent_knowledge_documents",
    "20260725010673_app_data_agent_qa_conversation_directory",
  ],
  "20260725010674": [
    "20260725010674_app_data_agent_adaptive_dispatch",
    "20260725010674_app_data_agent_semantic_explicit_revisions",
  ],
  "20260725010675": [
    "20260725010675_app_data_agent_qa_admin_audit",
    "20260725010675_app_data_agent_semantic_self_publish",
  ],
  "20260725010676": [
    "20260725010676_app_data_agent_qa_admin_audit_coalesce_repair",
    "20260725010676_app_data_agent_semantic_provider_authority",
  ],
  "20260725010677": [
    "20260725010677_app_data_agent_knowledge_document_authority_repair",
    "20260725010677_app_data_agent_qa_admin_audit_failure_repair",
  ],
  "20260725010678": [
    "20260725010678_app_data_agent_knowledge_evidence_authority_repair",
    "20260725010678_app_data_agent_legacy_attribution_cleanup",
  ],
  "20260725010679": [
    "20260725010679_app_data_agent_knowledge_evidence_revision_repair",
    "20260725010679_app_data_agent_legacy_attribution_scope_repair",
  ],
};

export const GRANDFATHERED_MISSING_CHECKSUM_HEADERS = new Set([
  "20260725010100_app_data_agent_core",
  "20260725010200_app_data_agent_api",
  "20260725010300_app_data_agent_storage",
  "20260725010400_app_data_agent_egress",
  "20260725010500_app_data_agent_runtime_foundation",
  "20260725010505_app_data_agent_runtime_api",
  "20260725010510_app_data_agent_runtime_projection_invariants",
  "20260725010520_app_data_agent_runtime_queue_lease",
  "20260725010530_app_data_agent_runtime_event_settlement",
  "20260725010540_app_data_agent_runtime_checkpoint_effect",
  "20260725010550_app_data_agent_runtime_control",
  "20260725010560_app_data_agent_runtime_backend_acceptance",
  "20260725010570_app_data_agent_runtime_security",
  "20260725010580_app_data_agent_text2sql_system_store",
  "20260725010585_app_data_agent_benchmark_test_center",
  "20260725010601_app_data_agent_u6_research_controlled_fixture",
  "20260725010642_app_data_agent_semantic_authoring_audit",
  "20260725010643_app_data_agent_semantic_authoring_digest",
  "20260725010644_app_data_agent_semantic_authoring_events",
  "20260725010645_app_data_agent_semantic_authoring_review",
  "20260725010699_app_data_agent_analysis_artifact_authority",
]);

export const GRANDFATHERED_UNVERIFIABLE_CHECKSUMS = new Set([
  "20260725010615_app_data_agent_semantic_published_bridge",
  "20260725010621_app_data_agent_published_f9",
  "20260725010648_app_data_agent_qa_resource_binding",
]);

export interface MigrationSource {
  readonly name: string;
  readonly sql: string;
}

export interface MigrationInventoryViolation {
  readonly code:
    | "CHECKSUM_HEADER_MISSING"
    | "CHECKSUM_MISMATCH"
    | "DUPLICATE_SEQUENCE"
    | "FILENAME_INVALID"
    | "LEDGER_ASSERTION_INVALID"
    | "STEM_DECLARATION_MISMATCH";
  readonly file: string;
  readonly message: string;
}

export interface MigrationInventoryResult {
  readonly frontier: string;
  readonly nextSequence: string;
  readonly violations: readonly MigrationInventoryViolation[];
}

function computedChecksum(sql: string, declaredChecksum: string): string {
  const normalized = sql.split(declaredChecksum).join(ZERO_CHECKSUM);
  return `sha256:${createHash("sha256").update(normalized).digest("hex")}`;
}

function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  return [...left].sort().join("\u0000") === [...right].sort().join("\u0000");
}

export function verifyMigrationInventory(
  sources: readonly MigrationSource[],
): MigrationInventoryResult {
  const violations: MigrationInventoryViolation[] = [];
  const stemsBySequence = new Map<string, string[]>();
  let frontier = "00000000000000";

  for (const source of [...sources].sort((left, right) => left.name.localeCompare(right.name))) {
    const filename = migrationFilePattern.exec(source.name);
    if (!filename) {
      violations.push({
        code: "FILENAME_INVALID",
        file: source.name,
        message: "migration filename must use a 14 digit sequence and lowercase stem",
      });
      continue;
    }

    const sequence = filename[1] as string;
    const stem = source.name.slice(0, -4);
    frontier = sequence > frontier ? sequence : frontier;
    stemsBySequence.set(sequence, [...(stemsBySequence.get(sequence) ?? []), stem]);

    const declarations = [...source.sql.matchAll(ledgerAssertionPattern)];
    if (declarations.length !== 1) {
      violations.push({
        code: "LEDGER_ASSERTION_INVALID",
        file: source.name,
        message: `expected exactly one platform.assert_migration_checksum declaration, found ${declarations.length}`,
      });
      continue;
    }

    const declaredStem = declarations[0]?.[1];
    const ledgerChecksum = declarations[0]?.[2];
    if (declaredStem !== stem) {
      violations.push({
        code: "STEM_DECLARATION_MISMATCH",
        file: source.name,
        message: `filename stem ${stem} differs from ledger declaration ${declaredStem ?? "<missing>"}`,
      });
    }

    const headerChecksum = checksumHeaderPattern.exec(source.sql)?.[1];
    if (!headerChecksum) {
      if (!GRANDFATHERED_MISSING_CHECKSUM_HEADERS.has(stem)) {
        violations.push({
          code: "CHECKSUM_HEADER_MISSING",
          file: source.name,
          message: "migration checksum header is required for every new migration",
        });
      }
      continue;
    }

    const checksumIsGrandfathered = GRANDFATHERED_UNVERIFIABLE_CHECKSUMS.has(stem);
    if (
      !checksumIsGrandfathered &&
      (headerChecksum !== ledgerChecksum ||
        computedChecksum(source.sql, headerChecksum) !== headerChecksum)
    ) {
      violations.push({
        code: "CHECKSUM_MISMATCH",
        file: source.name,
        message: "checksum header, ledger declaration and normalized file digest must match",
      });
    }
  }

  for (const [sequence, stems] of stemsBySequence) {
    if (stems.length < 2) continue;
    const grandfathered = GRANDFATHERED_DUPLICATE_SEQUENCES[sequence];
    if (!grandfathered || !sameMembers(stems, grandfathered)) {
      violations.push({
        code: "DUPLICATE_SEQUENCE",
        file: stems
          .map((stem) => `${stem}.sql`)
          .sort()
          .join(","),
        message: `migration sequence ${sequence} is already used by ${stems.sort().join(",")}`,
      });
    }
  }

  return {
    frontier,
    nextSequence: (BigInt(frontier) + 1n).toString().padStart(14, "0"),
    violations: violations.sort((left, right) =>
      `${left.code}\u0000${left.file}`.localeCompare(`${right.code}\u0000${right.file}`),
    ),
  };
}
