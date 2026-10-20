// `POST /rpc/:op` dispatch: op lookup, input validation, handler call, error mapping.
// Logs carry op names, error codes and error class names only, never bodies or messages.
import { ApiError, ops as defaultOps, type ErrorCode } from "@emos/api-contract";
import type { ServiceContext } from "./context.js";
import { handlers as defaultHandlers } from "./handlers/index.js";

/** What every op definition provides (structural, so tests can pass their own ops). */
interface SchemaLike {
  safeParse(
    v: unknown,
  ):
    | { success: true; data: unknown }
    | { success: false; error: { issues: ReadonlyArray<{ path: PropertyKey[]; code: string }> } };
}
export interface OpLike {
  input: SchemaLike;
  output: SchemaLike;
}
export type AnyHandler = (ctx: ServiceContext, input: unknown) => unknown;

export type RpcBody =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: ErrorCode; message: string } };
export interface RpcResult {
  status: number;
  body: RpcBody;
}

const STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  not_found: 404,
  invalid_input: 400,
  conflict: 409,
  unavailable: 503,
  incompatible_version: 409,
  internal: 500,
};

export function statusForCode(code: ErrorCode): number {
  return STATUS[code];
}

export function errorResult(code: ErrorCode, message: string, status = STATUS[code]): RpcResult {
  return { status, body: { ok: false, error: { code, message } } };
}

/** `a.b[0]`-style paths and issue codes only: Zod messages can quote the offending values. */
function describeIssues(issues: ReadonlyArray<{ path: PropertyKey[]; code: string }>): string {
  const parts = issues.slice(0, 10).map((i) => {
    const path = i.path.map((p) => (typeof p === "number" ? `[${p}]` : String(p))).join(".");
    return `${path.replace(/\.\[/g, "[") || "(root)"}: ${i.code}`;
  });
  const more = issues.length > 10 ? ` (+${issues.length - 10} more)` : "";
  return `Invalid input: ${parts.join("; ")}${more}`;
}

function own<T>(registry: Record<string, T | undefined>, name: string): T | undefined {
  return Object.hasOwn(registry, name) ? registry[name] : undefined;
}

export async function dispatchRpc(
  ctx: ServiceContext,
  opName: string,
  rawBody: string,
  opts: {
    validateOutput: boolean;
    ops?: Record<string, OpLike>;
    handlers?: Record<string, AnyHandler | undefined>;
  },
): Promise<RpcResult> {
  const registry = opts.ops ?? (defaultOps as unknown as Record<string, OpLike>);
  const handlerMap =
    opts.handlers ?? (defaultHandlers as unknown as Record<string, AnyHandler | undefined>);

  const op = own(registry, opName);
  const handler = op && own(handlerMap, opName);
  if (!op || !handler) return errorResult("not_found", "Unknown op");

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return errorResult("invalid_input", "Request body must be JSON");
  }
  const input = op.input.safeParse(json);
  if (!input.success) return errorResult("invalid_input", describeIssues(input.error.issues));

  let result: unknown;
  try {
    result = await handler(ctx, input.data);
  } catch (e) {
    if (e instanceof ApiError) return errorResult(e.code, e.message);
    ctx.log.error("rpc.handler_failed", {
      op: opName,
      errorName: e instanceof Error ? e.name : typeof e,
    });
    return errorResult("internal", "Internal error");
  }

  if (opts.validateOutput) {
    const out = op.output.safeParse(result);
    if (!out.success) {
      ctx.log.error("rpc.output_invalid", { op: opName, issues: out.error.issues.length });
      return errorResult("internal", "Handler output failed validation");
    }
  }
  return { status: 200, body: { ok: true, result } };
}
