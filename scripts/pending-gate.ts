const [gate, requiredUnit] = process.argv.slice(2);

if (!gate || !requiredUnit) {
  process.stderr.write("用法：pending-gate <gate> <required-unit>\n");
  process.exit(64);
}

process.stdout.write(
  `${JSON.stringify(
    {
      gate,
      status: "NOT_IMPLEMENTED",
      release_decision: "HOLD",
      required_unit: requiredUnit,
      reason_code: "RELEASE_EVIDENCE_INCOMPLETE",
    },
    null,
    2,
  )}\n`,
);

process.exit(2);
