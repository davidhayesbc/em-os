import { describe, expect, it } from "vitest";
import { checkWorktreeLint } from "./check-worktree-lint.mjs";

describe("worktree lint exclusion", () => {
  it("uses root-relative .worktrees exclusion that does not ignore nested checkouts", () => {
    expect(checkWorktreeLint()).toBe("check-worktree-lint: ok");
  });
});
