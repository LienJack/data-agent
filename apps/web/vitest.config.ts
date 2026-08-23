import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["test/**/*.spec.ts", "test/**/*.spec.tsx"],
    exclude: [".next/**", "node_modules/**"],
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
