export type ConnectorErrorKind =
  | "transient"
  | "offline"
  | "auth"
  | "permission"
  | "schema"
  | "config";

export class ConnectorError extends Error {
  constructor(
    readonly kind: ConnectorErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}

export function isConnectorError(e: unknown): e is ConnectorError {
  return e instanceof ConnectorError;
}
