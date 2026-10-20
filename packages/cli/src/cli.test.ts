import { describe, expect, it } from "vitest";
import { runCli } from "./cli.js";
import type { Command } from "./command.js";
import { commands } from "./commands/index.js";
import { capture } from "./test-helpers.js";

const fake: Command = {
  name: "fake",
  summary: "does a thing",
  run: async (args, io) => {
    io.out(`args=${args.join(",")}\n`);
    return 7;
  },
};

describe("runCli", () => {
  it("dispatches to the named command with the remaining args and returns its exit code", async () => {
    const cap = capture();
    expect(await runCli(["fake", "a", "--b"], cap.io, [fake])).toBe(7);
    expect(cap.out()).toBe("args=a,--b\n");
  });

  it.each([[["--help"]], [["-h"]], [[]]])("%j prints usage and exits 2", async (argv) => {
    const cap = capture();
    expect(await runCli(argv, cap.io, [fake])).toBe(2);
    expect(cap.out() + cap.err()).toContain("Usage: emos <command>");
    expect(cap.out() + cap.err()).toContain("fake");
  });

  it("an unknown command prints usage to stderr and exits 2", async () => {
    const cap = capture();
    expect(await runCli(["nope"], cap.io, [fake])).toBe(2);
    expect(cap.err()).toContain("Unknown command: nope");
    expect(cap.err()).toContain("Usage: emos <command>");
  });

  it("an inherited property name is not a command", async () => {
    const cap = capture();
    expect(await runCli(["constructor"], cap.io, [fake])).toBe(2);
  });

  it("a command that throws is reported as a failure (exit 1)", async () => {
    const boom: Command = {
      name: "boom",
      summary: "",
      run: async () => {
        throw new Error("kaput");
      },
    };
    const cap = capture();
    expect(await runCli(["boom"], cap.io, [boom])).toBe(1);
    expect(cap.err()).toContain("kaput");
  });
});

describe("commands registry", () => {
  it("registers doctor, backup and service", () => {
    expect(commands.map((c) => c.name)).toEqual(["doctor", "backup", "service"]);
  });
});
