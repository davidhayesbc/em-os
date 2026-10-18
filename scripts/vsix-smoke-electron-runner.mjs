import { runTests } from "@vscode/test-electron";
import { readFileSync } from "node:fs";

const options = JSON.parse(readFileSync(process.argv[2], "utf8"));
await runTests(options);
