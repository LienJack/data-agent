import { falcon24TargetAuthorityEpochSchema } from "../packages/contracts/src/runs/falcon24-authority-identity.js";

function argument(name: string): string | undefined {
  const direct = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (direct) return direct.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const authorityEpoch = falcon24TargetAuthorityEpochSchema.safeParse(argument("authority-epoch"));
if (!authorityEpoch.success) {
  process.stderr.write(
    `${JSON.stringify({ terminal: "HOLD", reason_code: "FALCON24_AUTHORITY_EPOCH_INVALID" })}\n`,
  );
  process.exitCode = 1;
} else {
  await import("./build-falcon24-e1-baseline.js");
}
