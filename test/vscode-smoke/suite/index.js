const assert = require("node:assert/strict");
const vscode = require("vscode");

const commands = [
  "em-os.sync",
  "em-os.openInbox",
  "em-os.whatNext",
  "em-os.draftWeeklyUpdate",
  "em-os.captureEvidence",
];

async function within(promise, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), 10_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function invoke(command) {
  const invocation = vscode.commands.executeCommand(command);
  await new Promise((resolve) => setTimeout(resolve, 100));
  await vscode.commands.executeCommand("workbench.action.closeQuickOpen");
  const available = await vscode.commands.getCommands(true);
  for (const candidate of ["notifications.clearAll", "notifications.hideList"]) {
    if (available.includes(candidate)) await vscode.commands.executeCommand(candidate);
  }
  await within(invocation, `${command} invocation`);
}

exports.run = async function run() {
  const id = process.env.EM_OS_EXPECTED_EXTENSION;
  const extension = vscode.extensions.getExtension(id);
  assert.ok(extension, `installed extension ${id} was not found`);
  await within(extension.activate(), `${id} activation`);
  assert.equal(extension.isActive, true, `${id} did not become active`);

  const registered = await vscode.commands.getCommands(true);
  for (const command of commands) {
    assert.ok(registered.includes(command), `${command} is not registered`);
    await invoke(command);
    console.log(`[packaged-vsix-smoke] invoked ${command}`);
  }
};
