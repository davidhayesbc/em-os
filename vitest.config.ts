import { defineConfig } from "vitest/config";

// Vitest 4+ replaced `vitest.workspace.ts` with `test.projects`.
// One project per workspace package, plus the root-level repo scripts.
export default defineConfig({
  test: {
    projects: [{ test: { name: "scripts", include: ["scripts/**/*.test.ts"] } }, "packages/*"],
  },
});
