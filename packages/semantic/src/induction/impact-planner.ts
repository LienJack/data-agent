import { buildSemanticImpactPlan, type SemanticImpactPlan } from "@data-agent/contracts";

type ImpactObject = Readonly<{
  object_id: string;
  object_kind: SemanticImpactPlan["affected_objects"][number]["object_kind"];
  previous_hash: string;
  next_hash: string;
}>;

export async function planSemanticImpact(
  input: Readonly<{
    scope: SemanticImpactPlan["scope"];
    semantic_domain: string;
    induction_id: string;
    objects: readonly ImpactObject[];
    dependencies: readonly Readonly<{ source_object_id: string; dependent_object_id: string }>[];
  }>,
): Promise<SemanticImpactPlan> {
  const objectById = new Map(input.objects.map((object) => [object.object_id, object]));
  if (objectById.size !== input.objects.length)
    throw new TypeError("SEMANTIC_IMPACT_OBJECT_DUPLICATE");
  const changed = input.objects
    .filter((object) => object.previous_hash !== object.next_hash)
    .map((object) => object.object_id)
    .sort();
  if (changed.length === 0) throw new TypeError("SEMANTIC_IMPACT_CHANGE_REQUIRED");
  const dependents = new Map<string, string[]>();
  for (const dependency of input.dependencies) {
    if (
      !objectById.has(dependency.source_object_id) ||
      !objectById.has(dependency.dependent_object_id)
    ) {
      throw new TypeError("SEMANTIC_IMPACT_DEPENDENCY_UNKNOWN");
    }
    const values = dependents.get(dependency.source_object_id) ?? [];
    values.push(dependency.dependent_object_id);
    dependents.set(dependency.source_object_id, values);
  }
  const affected = new Set(changed);
  const queue = [...changed];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    for (const dependent of [...(dependents.get(current) ?? [])].sort()) {
      if (!affected.has(dependent)) {
        affected.add(dependent);
        queue.push(dependent);
      }
    }
  }
  return buildSemanticImpactPlan({
    schema_version: "semantic-impact-plan@1.0.0",
    scope: input.scope,
    semantic_domain: input.semantic_domain,
    induction_id: input.induction_id,
    changed_object_ids: changed,
    affected_objects: [...affected]
      .sort()
      .map((objectId) => objectById.get(objectId))
      .filter((object): object is ImpactObject => object !== undefined),
    unchanged_object_hashes: input.objects
      .filter((object) => !affected.has(object.object_id))
      .map((object) => ({ object_id: object.object_id, object_hash: object.next_hash }))
      .sort((left, right) => left.object_id.localeCompare(right.object_id)),
  });
}
