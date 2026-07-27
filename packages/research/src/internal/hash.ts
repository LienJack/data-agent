import { sha256ContentHash } from "@data-agent/contracts";

export function computeResearchKernelHash(
  hashDomain: string,
  value: unknown,
): Promise<`sha256:${string}`> {
  return sha256ContentHash({
    hash_domain: hashDomain,
    value,
  });
}
