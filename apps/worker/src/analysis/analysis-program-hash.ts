import type { AnalysisProgramPayload } from "@data-agent/contracts/artifacts";
import { sha256ContentHash } from "@data-agent/contracts/common";

export function computeAnalysisProgramHash(
  program: Omit<AnalysisProgramPayload, "program_hash">,
): Promise<`sha256:${string}`> {
  return sha256ContentHash({ hash_domain: program.protocol_version, value: program });
}
