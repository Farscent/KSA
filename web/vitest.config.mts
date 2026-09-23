import { defineConfig } from "vitest/config";

/**
 * Unit tests for the calculation layer — `lib/research/project.ts` and
 * `lib/agent/metrics.ts`.
 *
 * These are the files the "LLM never does math" guarantee rests on, so they
 * are tested against real captured Sectors payloads in web/fixtures/research/.
 * Nothing here touches the network: the tests run offline at zero credits.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
