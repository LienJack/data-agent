export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { initializeWebRuntimeBuildIdentity } = await import("./lib/runtime-build-identity");
  const identity = initializeWebRuntimeBuildIdentity();
  const [{ registerPersistenceDiagnosticLogger }, { writeWebPersistenceDiagnostic }] =
    await Promise.all([import("@data-agent/platform"), import("./lib/operations-diagnostics")]);
  registerPersistenceDiagnosticLogger({
    identity,
    logger: writeWebPersistenceDiagnostic,
  });
  console.info(
    JSON.stringify({
      event_name: "web_runtime_started",
      build_id: identity.build_id,
      generation_id: identity.generation_id,
      git_commit: identity.git_commit,
      git_dirty: identity.git_dirty,
    }),
  );
  const { initializeSystemModels } = await import("./lib/model-store");
  initializeSystemModels();
}
