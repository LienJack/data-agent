export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { initializeSystemModels } = await import("./lib/model-store");
  initializeSystemModels();
}
