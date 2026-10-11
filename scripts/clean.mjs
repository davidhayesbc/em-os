import { rm } from "node:fs/promises";

for (const directory of ["packages/core/dist", "packages/cli/dist", "packages/vscode-extension/dist"]) {
  await rm(directory, { recursive: true, force: true });
}
for (const buildInfo of [
  "packages/core/tsconfig.tsbuildinfo",
  "packages/cli/tsconfig.tsbuildinfo",
  "packages/vscode-extension/tsconfig.tsbuildinfo",
]) {
  await rm(buildInfo, { force: true });
}
