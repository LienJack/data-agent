import { z } from "zod";

export const FALCON24_E1_AUTHORITY_EPOCH = "E1" as const;
export const FALCON24_TARGET_AUTHORITY_EPOCH = "E2" as const;

export const falcon24AuthorityEpochSchema = z
  .string()
  .regex(/^E[1-9][0-9]*$/u, "Falcon24 authority epoch 必须使用 canonical E<n> identity。");

export const falcon24E1AuthorityEpochSchema = z.literal(FALCON24_E1_AUTHORITY_EPOCH);
export const falcon24TargetAuthorityEpochSchema = z.literal(FALCON24_TARGET_AUTHORITY_EPOCH);
export const falcon24SuccessorAuthorityEpochSchema = falcon24AuthorityEpochSchema.refine(
  (epoch) => epoch !== FALCON24_E1_AUTHORITY_EPOCH,
  "Falcon24 v2 authority document 不能重写历史 E1。",
);

export function falcon24AuthorityEpochOrdinal(input: unknown): bigint {
  const epoch = falcon24AuthorityEpochSchema.parse(input);
  return BigInt(epoch.slice(1));
}

export function compareFalcon24AuthorityEpochs(left: unknown, right: unknown): -1 | 0 | 1 {
  const leftOrdinal = falcon24AuthorityEpochOrdinal(left);
  const rightOrdinal = falcon24AuthorityEpochOrdinal(right);
  if (leftOrdinal < rightOrdinal) return -1;
  if (leftOrdinal > rightOrdinal) return 1;
  return 0;
}

export type Falcon24AuthorityEpoch = z.infer<typeof falcon24AuthorityEpochSchema>;
