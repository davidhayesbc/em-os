import type { z } from "zod";
import type { ops } from "./ops/index.js";

/** Bumped on a breaking wire change; sent as `X-EMOS-API`. */
export const API_VERSION = 1;

export interface OpDef<I extends z.ZodTypeAny, O extends z.ZodTypeAny> {
  name: string;
  input: I;
  output: O;
}

export function defineOp<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
  def: OpDef<I, O>,
): OpDef<I, O> {
  return def;
}

export type OpName = keyof typeof ops;
/** What a caller passes (before defaults are applied). */
export type OpInput<N extends OpName> = z.input<(typeof ops)[N]["input"]>;
export type OpOutput<N extends OpName> = z.output<(typeof ops)[N]["output"]>;
/** What a handler receives after validation (defaults applied). */
export type OpParsedInput<N extends OpName> = z.output<(typeof ops)[N]["input"]>;
