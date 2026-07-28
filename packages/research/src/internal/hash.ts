import {
  type ContentHash,
  computeResearchKernelHashV2 as computeResearchKernelHashContractV2,
  sha256ContentHash,
} from "@data-agent/contracts";

export function computeResearchKernelHash(
  hashDomain: string,
  value: unknown,
): Promise<`sha256:${string}`> {
  return sha256ContentHash({
    hash_domain: hashDomain,
    value,
  });
}

export function computeResearchKernelHashV2(
  hashDomain: string,
  value: unknown,
): Promise<ContentHash> {
  return computeResearchKernelHashContractV2(hashDomain, value);
}
