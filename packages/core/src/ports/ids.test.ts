import { describe, expect, it } from "vitest";
import { fixedClock } from "./clock.js";
import { createUlidIdGen, ID_PREFIXES } from "./ids.js";

const CROCKFORD = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** Deterministic byte source: counts up so successive ids differ. */
function counterBytes(): (n: number) => Uint8Array {
  let c = 0;
  return (n) => Uint8Array.from({ length: n }, () => c++ % 256);
}

describe("createUlidIdGen", () => {
  it("produces <prefix>_ + 26-char Crockford base32 ULID", () => {
    const gen = createUlidIdGen(fixedClock("2026-10-20T16:00:00.000Z"), counterBytes());
    const id = gen.next("cmt");
    expect(id.startsWith("cmt_")).toBe(true);
    expect(id.slice(4)).toMatch(CROCKFORD);
  });

  it("encodes the timestamp in the first 10 chars (known vector: epoch 0 and max random)", () => {
    const gen = createUlidIdGen(fixedClock("1970-01-01T00:00:00.000Z"), (n) =>
      new Uint8Array(n).fill(0xff),
    );
    expect(gen.next("per")).toBe("per_0000000000ZZZZZZZZZZZZZZZZ");
  });

  it("is time-sortable across an increasing clock", () => {
    let t = Date.parse("2026-10-20T16:00:00.000Z");
    const gen = createUlidIdGen({ now: () => new Date(t) }, counterBytes());
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(gen.next("mtg"));
      t += 1 + i * 1000;
    }
    expect([...ids].sort()).toEqual(ids);
  });

  it("generates distinct ids for the same instant", () => {
    const gen = createUlidIdGen(fixedClock("2026-10-20T16:00:00.000Z"), counterBytes());
    expect(gen.next("src")).not.toBe(gen.next("src"));
  });

  it("accepts every documented prefix", () => {
    const gen = createUlidIdGen(fixedClock("2026-10-20T16:00:00.000Z"), counterBytes());
    expect([...ID_PREFIXES]).toEqual([
      "per",
      "idn",
      "pnt",
      "gol",
      "cmt",
      "mtg",
      "src",
      "rsk",
      "dec",
      "doc",
      "acc",
      "mcl",
    ]);
    for (const p of ID_PREFIXES) expect(gen.next(p).startsWith(`${p}_`)).toBe(true);
  });

  it("throws on an unknown prefix", () => {
    const gen = createUlidIdGen(fixedClock("2026-10-20T16:00:00.000Z"), counterBytes());
    expect(() => gen.next("zzz")).toThrow(/unknown id prefix/i);
    expect(() => gen.next("")).toThrow();
  });

  it("throws if randomBytes returns too few bytes", () => {
    const gen = createUlidIdGen(fixedClock("2026-10-20T16:00:00.000Z"), () => new Uint8Array(3));
    expect(() => gen.next("cmt")).toThrow();
  });
});
