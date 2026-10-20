import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertSingleTarget,
  expectedArchiveSha256,
  hostTarget,
  parseShasums,
  parseTargetArg,
  serviceBundleOptions,
  sha256File,
  TARGETS,
  verifySha256,
  vsixFileName,
} from "./package-lib.mjs";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("targets", () => {
  it("maps darwin-arm64 to the official tarball, bin/node and the darwin keyring binary", () => {
    const t = TARGETS["darwin-arm64"];
    expect(t.npmOs).toBe("darwin");
    expect(t.npmCpu).toBe("arm64");
    expect(t.nodeArchive("24.22.0")).toBe("node-v24.22.0-darwin-arm64.tar.xz");
    expect(t.nodeMember("24.22.0")).toBe("node-v24.22.0-darwin-arm64/bin/node");
    expect(t.runtimeName).toBe("node");
    expect(t.keyringPackage).toBe("@napi-rs/keyring-darwin-arm64");
  });

  it("maps win32-x64 to the official zip, node.exe and the msvc keyring binary", () => {
    const t = TARGETS["win32-x64"];
    expect(t.npmOs).toBe("win32");
    expect(t.npmCpu).toBe("x64");
    expect(t.nodeArchive("24.22.0")).toBe("node-v24.22.0-win-x64.zip");
    expect(t.nodeMember("24.22.0")).toBe("node-v24.22.0-win-x64/node.exe");
    expect(t.runtimeName).toBe("node.exe");
    expect(t.keyringPackage).toBe("@napi-rs/keyring-win32-x64-msvc");
  });

  it("hostTarget picks the current platform's target and rejects unsupported ones", () => {
    expect(hostTarget("darwin", "arm64")).toBe("darwin-arm64");
    expect(hostTarget("win32", "x64")).toBe("win32-x64");
    expect(() => hostTarget("linux", "x64")).toThrow(/No VSIX target for linux-x64/);
    expect(() => hostTarget("darwin", "x64")).toThrow(/darwin-arm64, win32-x64/);
  });

  it("parseTargetArg reads --target (both spellings) and defaults to the host", () => {
    expect(parseTargetArg(["--target", "win32-x64"], "darwin", "arm64")).toBe("win32-x64");
    expect(parseTargetArg(["--target=darwin-arm64"], "win32", "x64")).toBe("darwin-arm64");
    expect(parseTargetArg([], "darwin", "arm64")).toBe("darwin-arm64");
    expect(() => parseTargetArg(["--target", "linux-x64"], "darwin", "arm64")).toThrow(
      /Unsupported target: linux-x64/,
    );
    expect(() => parseTargetArg(["--target"], "darwin", "arm64")).toThrow(/--target needs a value/);
    expect(() => parseTargetArg(["--frobnicate"], "darwin", "arm64")).toThrow(/Unknown argument/);
  });

  it("names the VSIX em-os-<target>-<version>.vsix", () => {
    expect(vsixFileName("darwin-arm64", "0.0.0")).toBe("em-os-darwin-arm64-0.0.0.vsix");
  });
});

describe("checksums", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const tempFile = (content: string) => {
    const dir = mkdtempSync(join(tmpdir(), "emos-pkg-"));
    dirs.push(dir);
    const f = join(dir, "archive.bin");
    writeFileSync(f, content);
    return f;
  };

  it("parses SHASUMS256.txt lines (text and binary markers)", () => {
    const text = [
      `${sha("a")}  node-v24.22.0-darwin-arm64.tar.xz`,
      `${sha("b")} *node-v24.22.0-win-x64.zip`,
      "",
      "garbage line",
    ].join("\n");
    const sums = parseShasums(text);
    expect(sums.get("node-v24.22.0-darwin-arm64.tar.xz")).toBe(sha("a"));
    expect(sums.get("node-v24.22.0-win-x64.zip")).toBe(sha("b"));
    expect(sums.size).toBe(2);
  });

  it("expectedArchiveSha256 needs the pin and SHASUMS256.txt to agree", () => {
    const pin = { version: "24.22.0", sha256: { "n.tar.xz": sha("a") } };
    expect(expectedArchiveSha256(pin, "n.tar.xz", new Map([["n.tar.xz", sha("a")]]))).toBe(
      sha("a"),
    );
    expect(() => expectedArchiveSha256(pin, "n.tar.xz", new Map([["n.tar.xz", sha("b")]]))).toThrow(
      /does not match SHASUMS256.txt/,
    );
    expect(() => expectedArchiveSha256(pin, "n.tar.xz", new Map())).toThrow(
      /not listed in SHASUMS256.txt/,
    );
    expect(() => expectedArchiveSha256(pin, "other.zip", new Map())).toThrow(/No pinned sha256/);
  });

  it("verifySha256 passes on a match and fails closed on a mismatch", async () => {
    const f = tempFile("node binary bytes");
    expect(await sha256File(f)).toBe(sha("node binary bytes"));
    await expect(verifySha256(f, sha("node binary bytes"))).resolves.toBeUndefined();
    await expect(verifySha256(f, sha("tampered"))).rejects.toThrow(/Checksum mismatch/);
    await expect(verifySha256(f, sha("node binary bytes").toUpperCase())).resolves.toBeUndefined();
  });
});

describe("assertSingleTarget", () => {
  const files = (extra: string[] = []) => [
    "extension/dist/extension.js",
    "extension/dist/service/main.js",
    "extension/dist/service/node_modules/@napi-rs/keyring/index.js",
    "extension/dist/service/node_modules/@napi-rs/keyring-darwin-arm64/keyring.darwin-arm64.node",
    "extension/dist/runtime/node",
    ...extra,
  ];

  it("accepts exactly one runtime and only the target's keyring binary", () => {
    expect(() => assertSingleTarget(files(), "darwin-arm64")).not.toThrow();
  });

  it("rejects a missing or wrong-platform runtime", () => {
    expect(() =>
      assertSingleTarget(
        files().filter((f) => !f.endsWith("runtime/node")),
        "darwin-arm64",
      ),
    ).toThrow(/exactly one Node runtime/);
    expect(() =>
      assertSingleTarget(files(["extension/dist/runtime/node.exe"]), "darwin-arm64"),
    ).toThrow(/exactly one Node runtime/);
  });

  it("rejects other platforms' keyring binaries and a missing one", () => {
    expect(() =>
      assertSingleTarget(
        files([
          "extension/dist/service/node_modules/@napi-rs/keyring-win32-x64-msvc/keyring.win32-x64-msvc.node",
        ]),
        "darwin-arm64",
      ),
    ).toThrow(/keyring-win32-x64-msvc/);
    expect(() =>
      assertSingleTarget(
        files().filter((f) => !f.includes("keyring-darwin-arm64")),
        "darwin-arm64",
      ),
    ).toThrow(/exactly one .node addon/);
  });
});

describe("serviceBundleOptions", () => {
  it("bundles the service from source with the extension's version baked in", async () => {
    const dir = mkdtempSync(join(tmpdir(), "emos-svc-bundle-"));
    try {
      const outfile = join(dir, "main.js");
      const entry = join(import.meta.dirname, "..", "..", "service", "src", "main.ts");
      await build({
        ...serviceBundleOptions({ entry, outfile, version: "9.8.7" }),
        logLevel: "silent",
      });
      const js = readFileSync(outfile, "utf8");
      expect(js).toContain('"9.8.7"');
      expect(js).not.toContain("__EMOS_VERSION__");
      expect(js).not.toMatch(/from "zod"|from "@emos\//); // workspace packages and zod inlined
      expect(js).toMatch(/from "@napi-rs\/keyring"/); // the native addon stays external
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
