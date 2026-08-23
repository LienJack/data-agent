import { buildSemanticImpactPlan, type SemanticImpactPlan } from "@data-agent/contracts";

type ImpactObject = Readonly<{
  object_id: string;
  object_kind: SemanticImpactPlan["affected_objects"][number]["object_kind"];
  previous_hash: string;
  next_hash: string;
}>;

export interface TransitiveDependency {
  readonly source_object_id: string;
  readonly dependent_object_id: string;
}

export interface TransitiveAffectedObject {
  readonly object_id: string;
  readonly source_object_ids: readonly string[];
}

function compareCanonical(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function collectTransitiveDependents(
  input: Readonly<{
    roots: readonly string[];
    dependencies: readonly TransitiveDependency[];
    known_object_ids?: ReadonlySet<string>;
  }>,
): readonly TransitiveAffectedObject[] {
  const roots = [...new Set(input.roots)].sort(compareCanonical);
  if (roots.length === 0) return [];
  if (input.known_object_ids) {
    for (const root of roots) {
      if (!input.known_object_ids.has(root)) {
        throw new TypeError("SEMANTIC_IMPACT_ROOT_UNKNOWN");
      }
    }
  }

  const dependents = new Map<string, Set<string>>();
  for (const dependency of input.dependencies) {
    if (
      input.known_object_ids &&
      (!input.known_object_ids.has(dependency.source_object_id) ||
        !input.known_object_ids.has(dependency.dependent_object_id))
    ) {
      throw new TypeError("SEMANTIC_IMPACT_DEPENDENCY_UNKNOWN");
    }
    const values = dependents.get(dependency.source_object_id) ?? new Set<string>();
    values.add(dependency.dependent_object_id);
    dependents.set(dependency.source_object_id, values);
  }

  const sourcesByObject = new Map<string, Set<string>>();
  const queue: Array<readonly [string, string]> = [];
  for (const root of roots) {
    sourcesByObject.set(root, new Set([root]));
    queue.push([root, root]);
  }
  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) continue;
    const [objectId, root] = next;
    for (const dependent of [...(dependents.get(objectId) ?? [])].sort(compareCanonical)) {
      const sources = sourcesByObject.get(dependent) ?? new Set<string>();
      if (sources.has(root)) continue;
      sources.add(root);
      sourcesByObject.set(dependent, sources);
      queue.push([dependent, root]);
    }
  }

  return [...sourcesByObject.entries()]
    .map(([object_id, sourceIds]) => ({
      object_id,
      source_object_ids: [...sourceIds].sort(compareCanonical),
    }))
    .sort((left, right) => compareCanonical(left.object_id, right.object_id));
}

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
  const affected = new Set(
    collectTransitiveDependents({
      roots: changed,
      dependencies: input.dependencies,
      known_object_ids: new Set(objectById.keys()),
    }).map(({ object_id }) => object_id),
  );
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
