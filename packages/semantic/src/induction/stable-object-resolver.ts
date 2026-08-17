import {
  type SemanticStableObjectIdentity,
  type SemanticStableObjectIdentityMaterial,
  semanticStableObjectIdentityMaterialSchema,
  semanticStableObjectIdentitySchema,
  semanticStableObjectIdFromIdentityHash,
  sha256ContentHash,
} from "@data-agent/contracts";

export type StableSemanticFact = Readonly<{
  namespace: string;
  object_role: SemanticStableObjectIdentityMaterial["object_role"];
  name: string;
  aliases: readonly string[];
  mapping_identities: readonly string[];
  evidence_identities: readonly string[];
}>;

export type StableSemanticIdentityConflict = Readonly<{
  code: "SEMANTIC_STABLE_IDENTITY_CONFLICT";
  namespace: string;
  object_role: SemanticStableObjectIdentityMaterial["object_role"];
  normalized_name: string;
  mapping_sets: readonly (readonly string[])[];
}>;

function normalizeName(input: string): string {
  return input
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
}

function canonical(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.normalize("NFC").trim()).filter(Boolean))].sort();
}

export async function resolveStableSemanticObjects(input: readonly StableSemanticFact[]): Promise<
  Readonly<{
    objects: readonly SemanticStableObjectIdentity[];
    conflicts: readonly StableSemanticIdentityConflict[];
  }>
> {
  const facts = input.map((fact) => ({
    ...fact,
    normalized_name: normalizeName(fact.name),
    normalized_aliases: canonical(fact.aliases.map(normalizeName)),
    mapping_identities: canonical(fact.mapping_identities),
    evidence_identities: canonical(fact.evidence_identities),
  }));
  if (
    facts.some(
      (fact) =>
        !fact.normalized_name ||
        fact.mapping_identities.length === 0 ||
        fact.evidence_identities.length === 0,
    )
  ) {
    throw new TypeError("SEMANTIC_STABLE_IDENTITY_INPUT_INVALID");
  }

  const conflicts: StableSemanticIdentityConflict[] = [];
  const byPrimary = new Map<string, typeof facts>();
  for (const fact of facts) {
    const key = `${fact.namespace}\u0000${fact.object_role}\u0000${fact.normalized_name}`;
    const values = byPrimary.get(key) ?? [];
    values.push(fact);
    byPrimary.set(key, values);
  }
  const conflictedKeys = new Set<string>();
  for (const [key, values] of byPrimary) {
    const mappingSets = canonical(values.map((value) => JSON.stringify(value.mapping_identities)));
    if (mappingSets.length > 1) {
      const [namespace = "", objectRole = "METRIC", normalizedName = ""] = key.split("\u0000");
      conflicts.push({
        code: "SEMANTIC_STABLE_IDENTITY_CONFLICT",
        namespace,
        object_role: objectRole as SemanticStableObjectIdentityMaterial["object_role"],
        normalized_name: normalizedName,
        mapping_sets: mappingSets.map((value) => JSON.parse(value) as string[]),
      });
      conflictedKeys.add(key);
    }
  }

  const eligible = facts.filter(
    (fact) =>
      !conflictedKeys.has(
        `${fact.namespace}\u0000${fact.object_role}\u0000${fact.normalized_name}`,
      ),
  );
  const parent = eligible.map((_, index) => index);
  const find = (index: number): number => {
    const current = parent[index] ?? index;
    if (current === index) return index;
    const root = find(current);
    parent[index] = root;
    return root;
  };
  const join = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };
  for (let left = 0; left < eligible.length; left += 1) {
    for (let right = left + 1; right < eligible.length; right += 1) {
      const a = eligible[left];
      const b = eligible[right];
      if (!a || !b || a.namespace !== b.namespace || a.object_role !== b.object_role) continue;
      const aNames = new Set([a.normalized_name, ...a.normalized_aliases]);
      const bNames = new Set([b.normalized_name, ...b.normalized_aliases]);
      if ([...aNames].some((name) => bNames.has(name))) join(left, right);
    }
  }

  const groups = new Map<number, typeof eligible>();
  eligible.forEach((fact, index) => {
    const root = find(index);
    const values = groups.get(root) ?? [];
    values.push(fact);
    groups.set(root, values);
  });

  const objects: SemanticStableObjectIdentity[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    if (!first) continue;
    const mappingSets = canonical(group.map((value) => JSON.stringify(value.mapping_identities)));
    if (mappingSets.length > 1) {
      conflicts.push({
        code: "SEMANTIC_STABLE_IDENTITY_CONFLICT",
        namespace: first.namespace,
        object_role: first.object_role,
        normalized_name:
          canonical(
            group.flatMap((fact) => [fact.normalized_name, ...fact.normalized_aliases]),
          )[0] ?? first.normalized_name,
        mapping_sets: mappingSets.map((value) => JSON.parse(value) as string[]),
      });
      continue;
    }
    const names = canonical(
      group.flatMap((fact) => [fact.normalized_name, ...fact.normalized_aliases]),
    );
    const material = semanticStableObjectIdentityMaterialSchema.parse({
      schema_version: "semantic-stable-object-identity-material@1.0.0",
      namespace: first.namespace,
      object_role: first.object_role,
      normalized_name: names[0],
      mapping_identities: canonical(group.flatMap((fact) => fact.mapping_identities)),
      evidence_identities: canonical(group.flatMap((fact) => fact.evidence_identities)),
    });
    const identityHash = await sha256ContentHash(material);
    objects.push(
      semanticStableObjectIdentitySchema.parse({
        schema_version: "semantic-stable-object-identity@1.0.0",
        object_id: semanticStableObjectIdFromIdentityHash(identityHash),
        identity_hash: identityHash,
        material,
        aliases: names.slice(1),
      }),
    );
  }
  objects.sort((left, right) => left.object_id.localeCompare(right.object_id));
  conflicts.sort((left, right) =>
    `${left.namespace}:${left.object_role}:${left.normalized_name}`.localeCompare(
      `${right.namespace}:${right.object_role}:${right.normalized_name}`,
    ),
  );
  return Object.freeze({ objects: Object.freeze(objects), conflicts: Object.freeze(conflicts) });
}
