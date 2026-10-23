import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const DB = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/agenda_it";

export default defineConfig({
  resolve: {
    alias: {
      "server-only": fileURLToPath(new URL("./tests/support/empty.ts", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["tests/integration/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      DATABASE_URL: DB,
      APP_URL: "https://turnos.example.test",
      APP_SECRET: "test-secret-0123456789-abcdefghijklmnopqrstuvwxyz",
      CRON_SECRET: "cron-secret-0123456789-abcdef",
      RESEND_API_KEY: "re_test_key",
      EMAIL_FROM: "Consultorio <turnos@example.test>",
    },
  },
});
