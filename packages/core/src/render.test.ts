import assert from "node:assert/strict";
import test from "node:test";
import { escapeTerminalControls } from "./render";

test("neutralizes terminal controls in untrusted output", () => {
  const rendered = escapeTerminalControls("title\n\u001b[31mred\u0007");
  assert.equal(rendered, "title\\u000a\\u001b[31mred\\u0007");
  assert.doesNotMatch(rendered, /[\u0000-\u001f\u007f-\u009f]/);
});
