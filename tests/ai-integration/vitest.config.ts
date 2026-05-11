import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../../"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/ai-integration/**/*.test.ts"],
    testTimeout: 60000,
    root: path.resolve(__dirname, "../../"),
    passWithNoTests: true,
  },
});
