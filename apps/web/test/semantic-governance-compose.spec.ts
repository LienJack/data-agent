import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const composeSource = readFileSync(
  fileURLToPath(new URL("../../../compose.yaml", import.meta.url)),
  "utf8",
);

describe("semantic governance compose runtime", () => {
  it("injects only the fixed workspace authority context into web", () => {
    expect(composeSource).not.toContain("SEMANTIC_GOVERNANCE_BACKEND");
    expect(composeSource).toContain(`SEMANTIC_DEPLOYMENT_ID: \${SEMANTIC_DEPLOYMENT_ID:-`);
    expect(composeSource).toContain(`SEMANTIC_TENANT_ID: \${SEMANTIC_TENANT_ID:-`);
    expect(composeSource).toContain(`SEMANTIC_PRINCIPAL_ID: \${SEMANTIC_PRINCIPAL_ID:-`);
    expect(composeSource).toContain(`SEMANTIC_ALLOWED_DOMAINS: \${SEMANTIC_ALLOWED_DOMAINS:-`);
    expect(composeSource).toContain("revenue,customer,marketing,sales,ecommerce");
  });
});
