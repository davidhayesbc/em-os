// Pure-ish helpers for scripts/package.mjs (unit-tested in package-lib.test.ts): VSIX targets,
// SHASUMS256.txt parsing and checksum verification, and the one-platform-per-VSIX assertion.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

/**
 * @typedef {object} Target
 * @property {string} npmOs `--os` for `npm install` (the keyring addon's platform package).
 * @property {string} npmCpu `--cpu` for `npm install`.
 * @property {(version: string) => string} nodeArchive File name under nodejs.org/dist/v<version>/.
 * @property {(version: string) => string} nodeMember Path of the binary inside that archive.
 * @property {"node" | "node.exe"} runtimeName File name under `dist/runtime/`.
 * @property {string} keyringPackage The `@napi-rs/keyring` platform package for this target.
 */

/** The platform-specific VSIXs we build (ADR 0001): one Node binary + one keyring addon each. */
/** @type {Readonly<Record<"darwin-arm64" | "win32-x64", Target>>} */
export const TARGETS = Object.freeze({
  "darwin-arm64": {
    npmOs: "darwin",
    npmCpu: "arm64",
    nodeArchive: (v) => `node-v${v}-darwin-arm64.tar.xz`,
    nodeMember: (v) => `node-v${v}-darwin-arm64/bin/node`,
    runtimeName: "node",
    keyringPackage: "@napi-rs/keyring-darwin-arm64",
  },
  "win32-x64": {
    npmOs: "win32",
    npmCpu: "x64",
    nodeArchive: (v) => `node-v${v}-win-x64.zip`,
    nodeMember: (v) => `node-v${v}-win-x64/node.exe`,
    runtimeName: "node.exe",
    keyringPackage: "@napi-rs/keyring-win32-x64-msvc",
  },
});

const TARGET_NAMES = Object.keys(TARGETS).join(", ");

/** @param {string} name @returns {name is keyof typeof TARGETS} */
function isTarget(name) {
  return Object.hasOwn(TARGETS, name);
}

/**
 * The VSIX target for this machine.
 * @param {string} platform `process.platform`
 * @param {string} arch `process.arch`
 * @returns {keyof typeof TARGETS}
 */
export function hostTarget(platform, arch) {
  const name = `${platform}-${arch}`;
  if (!isTarget(name)) {
    throw new Error(`No VSIX target for ${name} (supported: ${TARGET_NAMES}); pass --target`);
  }
  return name;
}

/**
 * `--target <name>` / `--target=<name>`; default = {@link hostTarget}.
 * @param {string[]} argv
 * @param {string} platform
 * @param {string} arch
 * @returns {keyof typeof TARGETS}
 */
export function parseTargetArg(argv, platform, arch) {
  let target;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--target") {
      target = argv[++i];
      if (!target) throw new Error("--target needs a value");
    } else if (arg?.startsWith("--target=")) {
      target = arg.slice("--target=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (target === undefined) return hostTarget(platform, arch);
  if (!isTarget(target)) throw new Error(`Unsupported target: ${target} (use ${TARGET_NAMES})`);
  return target;
}

/** @param {string} target @param {string} version */
export function vsixFileName(target, version) {
  return `em-os-${target}-${version}.vsix`;
}

/**
 * `SHASUMS256.txt` -> file name => lowercase hex sha256. Lines are `<hex>  <name>` (or
 * `<hex> *<name>`); anything else is skipped.
 * @param {string} text
 * @returns {Map<string, string>}
 */
export function parseShasums(text) {
  const sums = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(line.trim());
    if (m?.[1] && m[2]) sums.set(m[2], m[1].toLowerCase());
  }
  return sums;
}

/**
 * The sha256 an archive must have: the repo pin, which must also equal the published
 * SHASUMS256.txt entry (a changed upstream file or a stale pin both fail packaging).
 * @param {{ version: string; sha256: Record<string, string> }} pin node-runtime.json
 * @param {string} archive
 * @param {Map<string, string>} shasums
 */
export function expectedArchiveSha256(pin, archive, shasums) {
  const pinned = pin.sha256[archive]?.toLowerCase();
  if (!pinned) throw new Error(`No pinned sha256 for ${archive} in node-runtime.json`);
  const published = shasums.get(archive);
  if (!published) throw new Error(`${archive} is not listed in SHASUMS256.txt`);
  if (published !== pinned) {
    throw new Error(
      `Pinned sha256 for ${archive} does not match SHASUMS256.txt (pinned ${pinned}, published ${published})`,
    );
  }
  return pinned;
}

/** @param {string} file @returns {Promise<string>} lowercase hex sha256 */
export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * Fails closed: throws unless `file` hashes to `expected`.
 * @param {string} file
 * @param {string} expected hex sha256
 */
export async function verifySha256(file, expected) {
  const actual = await sha256File(file);
  if (actual !== expected.toLowerCase()) {
    throw new Error(`Checksum mismatch for ${file}: expected ${expected}, got ${actual}`);
  }
}

/**
 * One platform per VSIX (ADR 0001): exactly one Node runtime (the target's), exactly one
 * `.node` addon (inside the target's keyring package) and no other keyring platform package.
 * @param {string[]} files paths inside the VSIX or staging dir (`/`-separated)
 * @param {keyof typeof TARGETS} target
 */
export function assertSingleTarget(files, target) {
  const t = TARGETS[target];
  const runtimes = files.filter((f) => /(^|\/)dist\/runtime\/node(\.exe)?$/.test(f));
  if (runtimes.length !== 1 || !runtimes[0]?.endsWith(`dist/runtime/${t.runtimeName}`)) {
    throw new Error(
      `${target}: expected exactly one Node runtime (dist/runtime/${t.runtimeName}), found [${runtimes.join(", ")}]`,
    );
  }
  const keyringPkgs = new Set(
    files.flatMap((f) => {
      const m = /node_modules\/(@napi-rs\/keyring-[^/]+)\//.exec(f);
      return m?.[1] ? [m[1]] : [];
    }),
  );
  for (const pkg of keyringPkgs) {
    if (pkg !== t.keyringPackage) {
      throw new Error(`${target}: unexpected keyring platform package ${pkg}`);
    }
  }
  const addons = files.filter((f) => f.endsWith(".node"));
  if (addons.length !== 1 || !addons[0]?.includes(`node_modules/${t.keyringPackage}/`)) {
    throw new Error(
      `${target}: expected exactly one .node addon (in ${t.keyringPackage}), found [${addons.join(", ")}]`,
    );
  }
}

/**
 * esbuild options for the VSIX's `dist/service/main.js`: one ESM file with the workspace
 * packages inlined, only `@napi-rs/keyring` external. Built from the service's *source* entry
 * so `__EMOS_VERSION__` becomes `version` (the extension's), which is what the extension's
 * launcher expects; the service's own dist already has its package version baked in.
 * @param {{ entry: string; outfile: string; version: string }} o
 */
export function serviceBundleOptions({ entry, outfile, version }) {
  return {
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    external: ["@napi-rs/keyring"],
    define: { __EMOS_VERSION__: JSON.stringify(version) },
    // Lets bundled CommonJS code `require` Node built-ins from ESM output.
    banner: {
      js: 'import { createRequire as __emosCreateRequire } from "node:module"; const require = __emosCreateRequire(import.meta.url);',
    },
    legalComments: "none",
    logLevel: "warning",
  };
}
