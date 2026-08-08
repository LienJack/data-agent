import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const postgresServicePath = fileURLToPath(
  new URL("../src/lib/postgres-semantic-governance-service.ts", import.meta.url),
);
const compatibilityMigrationPath = fileURLToPath(
  new URL(
    "../../../infra/supabase/apps/data-agent/migration-sources/10609/10-fail-closed-overload.sql.inc",
    import.meta.url,
  ),
);
const semanticDraftCleanupPath = fileURLToPath(
  new URL(
    "../../../infra/supabase/apps/data-agent/migration-sources/10622/30-publish-nullability.sql.inc",
    import.meta.url,
  ),
);
const attributionCompatibilityPath = fileURLToPath(
  new URL(
    "../../../infra/supabase/apps/data-agent/migration-sources/10619/10-fail-closed-helper.sql.inc",
    import.meta.url,
  ),
);
const attributionDigestCleanupPath = fileURLToPath(
  new URL(
    "../../../infra/supabase/apps/data-agent/migration-sources/10622/35-digest-compatibility-cleanup.sql.inc",
    import.meta.url,
  ),
);
const semanticLockRepairPath = fileURLToPath(
  new URL(
    "../../../infra/supabase/apps/data-agent/migration-sources/10622/32-semantic-lock-key-repair.sql.inc",
    import.meta.url,
  ),
);
const candidateAuthorityGrantPath = fileURLToPath(
  new URL(
    "../../../infra/supabase/apps/data-agent/migration-sources/10622/15-candidate-authority-grants.sql.inc",
    import.meta.url,
  ),
);

describe("semantic governance production source", () => {
  it("does not manufacture placeholder authority material", () => {
    const source = readFileSync(postgresServicePath, "utf8");

    expect(source).not.toMatch(/agent-proposer/);
    expect(source).not.toMatch(/crypto\.randomUUID/);
    expect(source).not.toMatch(/sha256:\$\{crypto\.randomUUID/);
    expect(source).not.toMatch(/手动回滚/);
  });

  it("keeps the historical GRANT shim fail-closed and removes it in 10622", () => {
    const compatibility = readFileSync(compatibilityMigrationPath, "utf8");
    const cleanup = readFileSync(semanticDraftCleanupPath, "utf8");

    expect(compatibility).toContain("security invoker");
    expect(compatibility).toContain("SEMANTIC_COMMIT_PUBLISH_COMPATIBILITY_SIGNATURE_DISABLED");
    expect(compatibility).toContain("revoke all on function semantic.commit_publish_attempt");
    expect(cleanup).toContain("drop function if exists semantic.commit_publish_attempt");
  });

  it("keeps the 10620 forward-reference helper inert until it is replaced", () => {
    const compatibility = readFileSync(attributionCompatibilityPath, "utf8");
    const cleanup = readFileSync(attributionDigestCleanupPath, "utf8");

    expect(compatibility).toContain("security invoker");
    expect(compatibility).toContain("ATTRIBUTION_CANONICAL_JSON_COMPATIBILITY_HELPER_DISABLED");
    expect(compatibility).toContain(
      "revoke all on function app_data_agent.attribution_canonical_json(jsonb)",
    );
    expect(compatibility).toContain("data-agent:10619:temporary-pgcrypto-parser-shim");
    expect(compatibility).toContain("revoke all on function pg_catalog.digest(bytea, text)");
    expect(compatibility).toContain("data_agent_10619_attribution_body_validation");
    expect(compatibility).toContain("pg_catalog.current_query()");
    expect(compatibility).toContain("pg_catalog.set_config('check_function_bodies', 'off', true)");
    expect(cleanup).toContain("extensions.digest(");
    expect(cleanup).toContain("drop function pg_catalog.digest(bytea, text)");
    expect(cleanup).toContain("drop event trigger data_agent_10619_attribution_body_validation");
  });

  it("derives the semantic advisory lock from framed digest bytes", () => {
    const repair = readFileSync(semanticLockRepairPath, "utf8");

    expect(repair).toContain("pg_catalog.jsonb_build_array(");
    expect(repair).toContain("pg_catalog.encode(");
    expect(repair).toContain("pg_catalog.substr(");
    expect(repair).not.toContain("'x' || substr(");
  });

  it("keeps Candidate table authority behind the NOLOGIN RPC owner", () => {
    const grants = readFileSync(candidateAuthorityGrantPath, "utf8");
    const rpc = readFileSync(
      fileURLToPath(
        new URL(
          "../../../infra/supabase/apps/data-agent/migration-sources/10622/20-candidate-rpc.sql.inc",
          import.meta.url,
        ),
      ),
      "utf8",
    );

    expect(grants).toContain("to data_agent_u6_rpc_owner");
    expect(grants).toContain(
      "revoke all on table semantic.semantic_candidate from data_agent_backend",
    );
    expect(grants).toContain("current_setting('app.semantic_domain', true)");
    expect(rpc).toContain("owner to data_agent_u6_rpc_owner");
  });
});
