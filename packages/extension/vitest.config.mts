import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests never load Electron: `vscode` resolves to a small hand-written mock.
export default defineConfig({
  resolve: {
    alias: { vscode: fileURLToPath(new URL("./src/test/vscode.ts", import.meta.url)) },
  },
  test: {
    name: "extension",
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
