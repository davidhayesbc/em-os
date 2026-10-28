import { describe, expect, it } from "vitest";
import {
  assertNestedCheckoutCurrentConfig,
  assertNestedCheckoutRevertedConfigFails,
  assertRootCheckoutCurrentConfig,
  assertRootCheckoutRemovedConfigFails,
  checkWorktreeLint,
} from "./check-worktree-lint.mjs";

describe("worktree lint exclusion", () => {
  it("passes with the current root-relative !.worktrees exclusion in a root checkout", () => {
    expect(assertRootCheckoutCurrentConfig()).toBe(true);
  });

  it("passes with the current root-relative !.worktrees exclusion in a nested .worktrees checkout", () => {
    expect(assertNestedCheckoutCurrentConfig()).toBe(true);
  });

  it("fails when the exclusion is reverted to !**/.worktrees in a nested .worktrees checkout", () => {
    expect(assertNestedCheckoutRevertedConfigFails()).toBe(true);
  });

  it("fails when the worktree exclusion is removed entirely", () => {
    expect(assertRootCheckoutRemovedConfigFails()).toBe(true);
  });

  it("orchestrator reports ok when all scenarios behave correctly", () => {
    expect(checkWorktreeLint()).toBe("check-worktree-lint: ok");
  });
});
