import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

function migrationSource(id: string, file: string): string {
  return readFileSync(
    resolve(root, `infra/supabase/apps/data-agent/migration-sources/${id}/${file}`),
    "utf8",
  );
}

describe("Research Analysis Worker authority migrations", () => {
  it("freezes one database-derived 13-purpose profile", () => {
    const provisioner = migrationSource("10712", "20-analysis-authority-provisioner.sql.inc");
    const assignments = [
      ...provisioner.matchAll(/\('([A-Z_]+)','([A-Z_]+)',(?:'([A-Z_]+)'|null)\)/g),
    ];

    expect(provisioner).toContain("envelope_json->>'profile'<>'RESEARCH_ANALYSIS_WORKER'");
    expect(assignments).toHaveLength(13);
    expect(new Set(assignments.map((match) => match[1])).size).toBe(13);
    expect(assignments.filter((match) => match[2] === "RESEARCH_ARTIFACT_AUTHORITY")).toHaveLength(
      12,
    );
    expect(assignments.find((match) => match[1] === "REPORT_READ")?.[2]).toBe(
      "REPORT_READ_AUTHORITY",
    );
    expect(provisioner).not.toContain("envelope_json->>'capability_id'");
    expect(provisioner).not.toContain("envelope_json->'capabilities'");
  });

  it("reuses the platform binding lock and removes the temporary helper", () => {
    const bindingReuse = migrationSource("10715", "20-binding-reuse.sql.inc");

    expect(bindingReuse).toContain("platform.lock_u6_authority_binding");
    expect(bindingReuse).toContain(
      "drop function platform.lock_research_analysis_provisioning_binding",
    );
    expect(bindingReuse).toContain("requested_membership_role");
  });

  it("limits provisioning access to locked membership rows and the bound scope", () => {
    const selectPolicy = migrationSource("10716", "20-provisioning-rls.sql.inc");
    const rowLockPolicy = migrationSource("10717", "20-provisioning-row-lock.sql.inc");
    const scope = migrationSource("10721", "20-provisioning-scope.sql.inc");

    expect(selectPolicy).toContain("memberships_u6_provisioner_lock_select");
    expect(rowLockPolicy).toContain("with check (false)");
    expect(scope).toContain("platform.lock_u6_authority_binding");
    expect(scope).toContain("app.u6_provision_app_id");
    expect(scope).toContain("app.u6_provision_tenant_id");
    expect(scope).toContain("app.u6_provision_environment");
  });
});
