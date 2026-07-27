import {
  type ArtifactReference,
  artifactReferenceIdentity,
  type L2ArtifactDocument,
  type L2ResearchDocumentCandidate,
} from "@data-agent/contracts";

export type ArtifactReferenceFor<ArtifactType extends ArtifactReference["artifact_type"]> =
  ArtifactReference & {
    readonly artifact_type: ArtifactType;
  };

type DocumentEnvelope = L2ArtifactDocument["envelope"] | L2ResearchDocumentCandidate["envelope"];

export function documentReference<
  ArtifactType extends ArtifactReference["artifact_type"],
>(document: {
  readonly envelope: DocumentEnvelope & {
    readonly artifact_type: ArtifactType;
  };
}): ArtifactReferenceFor<ArtifactType> {
  return {
    artifact_id: document.envelope.artifact_id,
    artifact_type: document.envelope.artifact_type,
    app_id: document.envelope.app_id,
    tenant_id: document.envelope.tenant_id,
    environment: document.envelope.environment,
    run_id: document.envelope.run_id,
    revision: document.envelope.revision,
    content_hash: document.envelope.content_hash,
  };
}

export function sameReference(left: ArtifactReference, right: ArtifactReference): boolean {
  return artifactReferenceIdentity(left) === artifactReferenceIdentity(right);
}

export function sameReferenceScope(left: ArtifactReference, right: ArtifactReference): boolean {
  return (
    left.app_id === right.app_id &&
    left.tenant_id === right.tenant_id &&
    left.environment === right.environment &&
    left.run_id === right.run_id
  );
}

export function stableCompare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function compareReferenceIdentity(
  left: ArtifactReference,
  right: ArtifactReference,
): number {
  return stableCompare(artifactReferenceIdentity(left), artifactReferenceIdentity(right));
}

export function sameIdentitySet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((identity) => right.has(identity));
}

export function hasExactReferenceIdentitySet(
  references: readonly ArtifactReference[],
  expectedIdentities: ReadonlySet<string>,
): boolean {
  const identities = references.map(artifactReferenceIdentity);
  return (
    identities.length === expectedIdentities.size &&
    new Set(identities).size === identities.length &&
    identities.every((identity) => expectedIdentities.has(identity))
  );
}

export function exactReferenceSet(
  actual: readonly ArtifactReference[],
  expected: readonly ArtifactReference[],
): boolean {
  const actualIdentities = actual.map(artifactReferenceIdentity);
  const expectedIdentities = expected.map(artifactReferenceIdentity);
  return (
    actualIdentities.length === expectedIdentities.length &&
    new Set(actualIdentities).size === actualIdentities.length &&
    new Set(expectedIdentities).size === expectedIdentities.length &&
    sameIdentitySet(new Set(actualIdentities), new Set(expectedIdentities))
  );
}

export function sameReferenceIdentityMultiset(
  left: readonly ArtifactReference[],
  right: readonly ArtifactReference[],
): boolean {
  const leftIdentities = left.map(artifactReferenceIdentity).sort(stableCompare);
  const rightIdentities = right.map(artifactReferenceIdentity).sort(stableCompare);
  return (
    leftIdentities.length === rightIdentities.length &&
    leftIdentities.every((identity, index) => identity === rightIdentities[index])
  );
}

export function containsAllReferenceIdentities(
  evaluated: readonly ArtifactReference[],
  required: readonly ArtifactReference[],
): boolean {
  const evaluatedIdentities = new Set(evaluated.map(artifactReferenceIdentity));
  return required.every((reference) =>
    evaluatedIdentities.has(artifactReferenceIdentity(reference)),
  );
}

export function uniqueReferences<Reference extends ArtifactReference>(
  references: readonly Reference[],
): Reference[] {
  return [
    ...new Map(
      references.map((reference) => [artifactReferenceIdentity(reference), reference]),
    ).values(),
  ];
}

export function mapByReferenceIdentity<Value extends { readonly ref: ArtifactReference }>(
  values: readonly Value[],
): Map<string, Value> | null {
  const resolved = new Map<string, Value>();
  for (const value of values) {
    const identity = artifactReferenceIdentity(value.ref);
    if (resolved.has(identity)) return null;
    resolved.set(identity, value);
  }
  return resolved;
}

export function orderedUniqueReferences(
  references: readonly ArtifactReference[],
): ArtifactReference[] {
  return [
    ...new Map(
      references.map((reference) => [artifactReferenceIdentity(reference), reference]),
    ).entries(),
  ]
    .sort(([left], [right]) => stableCompare(left, right))
    .map(([, reference]) => reference);
}
