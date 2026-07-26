import { randomUUID } from "node:crypto";
import { releaseDecisionSchema } from "../packages/contracts/src/runs/index.js";

const decision = releaseDecisionSchema.parse({
  decision_id: randomUUID(),
  app_id: randomUUID(),
  tenant_id: randomUUID(),
  environment: "local",
  run_id: randomUUID(),
  decision: "HOLD",
  reason_code: "RELEASE_EVIDENCE_INCOMPLETE",
  evidence_refs: [],
  authority: {
    kind: "deterministic",
    id: "verify-release",
    policy_version: "1.0.0",
  },
  release_policy_version: "1.0.0",
  decided_at: new Date().toISOString(),
});

process.stdout.write(
  `${JSON.stringify(
    {
      verification_contract_version: "1.1.0",
      ...decision,
      implemented_units: ["U1", "U2", "U3", "U4", "U5"],
      missing_units: ["U6", "U7", "U8", "U9"],
      missing_evidence: [
        {
          unit: "U5",
          evidence_type: "LOCAL_GATE_RECEIPT",
          required_command: "pnpm test:sandbox",
          reason_code: "RELEASE_GATE_NOT_ATTESTED",
        },
        {
          unit: "U9",
          evidence_type: "SIGNED_RELEASE_MANIFEST",
          required_command: "pnpm verify:release",
          reason_code: "RELEASE_MANIFEST_NOT_IMPLEMENTED",
        },
      ],
    },
    null,
    2,
  )}\n`,
);

process.exit(2);
