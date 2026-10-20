import { defineConfig } from "vitest/config";

// Webview tests run in jsdom. Vite 8 transforms JSX with oxc, so set the Preact runtime here
// (the package tsconfig only drives type-checking).
export default defineConfig({
  oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
  test: {
    name: "webview",
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test-setup.ts"],
  },
});
