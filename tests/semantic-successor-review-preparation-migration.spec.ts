import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const sourceDirectory = resolve(root, "infra/supabase/apps/data-agent/migration-sources/10792");
const migrationPath = resolve(
  root,
  "infra/supabase/apps/data-agent/migrations/20260725010792_app_data_agent_semantic_successor_review_preparation.sql",
);

function source(name: string): string {
  return readFileSync(resolve(sourceDirectory, name), "utf8");
}

describe("10792 semantic successor review preparation migration", () => {
  it("keeps preparation and human review separate from publication", () => {
    const storage = source("10-review-preparation-storage.sql.inc");
    const preparation = source("20-review-preparation-rpcs.sql.inc");

    expect(storage).toContain("semantic.semantic_successor_review_preparation");
    expect(storage).toContain("semantic.semantic_successor_review_decision_document");
    expect(preparation).toContain("semantic.prepare_falcon24_successor_review");
    expect(preparation).toContain("semantic.prepare_falcon24_successor_publish_attempt");
    expect(preparation).toContain("'WAITING_REVIEW'");
    expect(preparation).toContain("candidate_status='PUBLISHING'");
    expect(preparation).not.toContain("insert into semantic.semantic_source_release");
    expect(preparation).not.toContain("update semantic.semantic_active_pointer");
    expect(preparation).not.toContain("update semantic.semantic_runtime_activation");
  });

  it("recomputes the frozen ChangeSet and review hashes in PostgreSQL", () => {
    const preparation = source("20-review-preparation-rpcs.sql.inc");
    const review = source("30-human-review-rpc.sql.inc");

    expect(preparation).toContain(
      "app_data_agent.u2_canonical_sha256(change_set-'change_set_hash')",
    );
    expect(preparation).toContain("SEMANTIC_SUCCESSOR_CHANGE_SET_HASH_MISMATCH");
    expect(review).toContain("app_data_agent.u2_canonical_sha256(review_material)");
    expect(review).toContain("semantic-review-decision@1.0.0");
    expect(review).toContain("semantic.semantic_successor_review_decision_document");
  });

  it("binds idempotency, scope, review quorum, and exact predecessor CAS", () => {
    const preparation = source("20-review-preparation-rpcs.sql.inc");
    const review = source("30-human-review-rpc.sql.inc");

    expect(preparation).toContain("SEMANTIC_SUCCESSOR_REVIEW_IDEMPOTENCY_CONFLICT");
    expect(preparation).toContain("SEMANTIC_SUCCESSOR_POINTER_STALE");
    expect(preparation).toContain("semantic.lock_semantic_authority_fence");
    expect(preparation).toContain("semantic.lock_packet");
    expect(preparation).toContain("decision_window_status='CLOSED'");
    expect(preparation).toContain("review_outcome='APPROVED'");
    expect(review).toContain("SEMANTIC_REVIEWER_REQUIRED");
    expect(review).toContain("semantic.verify_principal_not_excluded");
  });

  it("keeps the new tables append-only and exposes only scoped review evidence plus RPCs", () => {
    const storage = source("10-review-preparation-storage.sql.inc");
    const security = source("80-security.sql.inc");
    const postconditions = source("90-postconditions.sql.inc");

    expect(storage.match(/semantic_successor_receipt_immutable/g)?.length).toBe(2);
    expect(security).toContain("force row level security");
    expect(security).toContain("from public,anon,authenticated,service_role,data_agent_backend");
    expect(security).toContain("semantic_successor_review_document_backend_read");
    expect(security).toContain(
      "grant select on table semantic.semantic_successor_review_decision_document",
    );
    expect(security).toContain("to data_agent_backend");
    expect(postconditions).toContain("SEMANTIC_SUCCESSOR_REVIEW_PREPARATION_POSTCONDITION_FAILED");
  });

  it("renders one checksum-bound forward migration", () => {
    const rendered = readFileSync(migrationPath, "utf8");

    expect(rendered).toContain("falcon24_semantic_successor_review_preparation_migration_checksum");
    expect(rendered).toContain(
      "20260725010792_app_data_agent_semantic_successor_review_preparation",
    );
    expect(rendered).not.toContain(
      "__FALCON24_SEMANTIC_SUCCESSOR_REVIEW_PREPARATION_MIGRATION_CHECKSUM__",
    );
  });
});
