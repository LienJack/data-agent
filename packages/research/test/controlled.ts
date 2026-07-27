import {
  listControlledMutationCases,
  listControlledPairCases,
} from "../src/server/controlled-fixture.js";
import {
  getControlledFixtureHandle,
  materializeControlledProtocolInput,
  runControlledProtocolKernel,
} from "../src/server.js";

export async function controlledHandle() {
  return getControlledFixtureHandle(
    "retail-revenue-investigation-v1",
    "u6-controlled-fixture@1.0.0",
  );
}

export async function controlledBaseEvaluation() {
  const handle = await controlledHandle();
  return runControlledProtocolKernel(materializeControlledProtocolInput(handle));
}

export async function controlledMutationCases() {
  return listControlledMutationCases(await controlledHandle());
}

export async function controlledPairCases() {
  return listControlledPairCases(await controlledHandle());
}
