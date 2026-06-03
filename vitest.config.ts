import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // JWT_SECRET set here so config/env.ts doesn't fail-fast during tests.
    env: {
      JWT_SECRET: "test-secret-key",
      NODE_ENV: "test",
    },
  },
});
