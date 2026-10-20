import { ApiError, ErrorCode } from "./errors.js";
import { API_VERSION, type OpInput, type OpName, type OpOutput } from "./op.js";

export interface Transport {
  post(
    path: string,
    body: unknown,
    headers: Record<string, string>,
  ): Promise<{ status: number; json: unknown }>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * Unwrap `{ ok: true, result } | { ok: false, error: { code, message } }`.
 * Anything else (including a non-JSON body, passed as `undefined`) is `ApiError("internal")`.
 */
function unwrap(json: unknown): unknown {
  if (isRecord(json)) {
    if (json.ok === true && "result" in json) return json.result;
    if (json.ok === false && isRecord(json.error)) {
      const { code, message } = json.error;
      if (typeof code === "string" && typeof message === "string") {
        const known = ErrorCode.safeParse(code);
        throw new ApiError(known.success ? known.data : "internal", message);
      }
    }
  }
  throw new ApiError("internal", "Malformed response from service");
}

export function createClient(opts: { transport: Transport; token: string }): {
  call<N extends OpName>(name: N, input: OpInput<N>): Promise<OpOutput<N>>;
} {
  const { transport, token } = opts;
  return {
    async call<N extends OpName>(name: N, input: OpInput<N>): Promise<OpOutput<N>> {
      const { json } = await transport.post(`/rpc/${name}`, input, {
        Authorization: `Bearer ${token}`,
        "X-EMOS-API": String(API_VERSION),
      });
      return unwrap(json) as OpOutput<N>;
    },
  };
}

export function httpTransport(baseUrl: string, fetchImpl: typeof fetch = fetch): Transport {
  const base = baseUrl.replace(/\/+$/, "");
  return {
    async post(path, body, headers) {
      let res: Response;
      try {
        res = await fetchImpl(`${base}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify(body),
        });
      } catch (cause) {
        throw new ApiError("unavailable", "Service unreachable", { cause });
      }
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        json = undefined; // non-JSON body; the client reports it as "internal"
      }
      return { status: res.status, json };
    },
  };
}
