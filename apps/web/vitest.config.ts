import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["test/**/*.spec.ts", "test/**/*.spec.tsx"],
    exclude: [".next/**", "node_modules/**"],
    testTimeout: 15_000,
  },
});
