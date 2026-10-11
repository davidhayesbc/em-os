import { createHash } from "node:crypto";

export type DataClass = "public" | "internal" | "confidential" | "sensitive-personnel";
export type ModelCapability = "structured" | "draft";
export type ApprovalPolicy = "pre-approved" | "interactive";

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
}

export interface ModelRouteConfig {
  route: string;
  provider: string;
  model: string;
  capabilities: readonly ModelCapability[];
  dataClassCeiling: DataClass;
  timeoutMs: number;
  tokenBudget: number;
  retry: RetryPolicy;
  approval: ApprovalPolicy;
  approved: boolean;
}

export interface GenerationRequest {
  job: string;
  promptVersion: string;
  inputRecordIds: readonly string[];
  dataClass: DataClass;
  audience: string;
  systemInstruction: string;
  untrustedData: readonly { recordId: string; text: string }[];
}

export interface RuntimeSchema<T> {
  readonly name: string;
  parse(value: unknown): T;
}

export interface ProviderRunResult<T> {
  value: T;
  tokenCount?: number;
  modelVersion?: string;
}

export interface ModelProvider {
  readonly provider: string;
  generateStructured<T>(
    request: GenerationRequest,
    schema: RuntimeSchema<T>,
    config: ModelRouteConfig,
    signal: AbortSignal,
  ): Promise<ProviderRunResult<T>>;
  generateDraft(
    request: GenerationRequest,
    config: ModelRouteConfig,
    signal: AbortSignal,
  ): Promise<ProviderRunResult<unknown>>;
}

export interface RunAudit {
  runId: string;
  job: string;
  route: string;
  provider: string;
  model: string;
  promptVersion: string;
  inputRecordIds: readonly string[];
  dataClass: DataClass;
  startedAt: string;
  endedAt: string;
  status: "succeeded" | "failed";
  attempts: number;
  tokenCount?: number;
  outputHash?: string;
  errorCode?: string;
}

export interface AuditSink {
  record(run: RunAudit): Promise<void> | void;
}

export class ModelPolicyError extends Error {
  constructor(public readonly code: "NO_APPROVED_ROUTE" | "APPROVAL_REQUIRED" | "INVALID_CONFIG", message: string) {
    super(message);
    this.name = "ModelPolicyError";
  }
}

export class ModelUnavailableError extends Error {
  constructor(public readonly code: "TIMEOUT" | "PROVIDER_FAILED" | "SCHEMA_REJECTED", message: string) {
    super(message);
    this.name = "ModelUnavailableError";
  }
}

const CLASS_RANK: Record<DataClass, number> = {
  public: 0,
  internal: 1,
  confidential: 2,
  "sensitive-personnel": 3,
};

export class ApprovedModelRouter {
  readonly #routes: readonly ModelRouteConfig[];

  constructor(routes: readonly ModelRouteConfig[]) {
    this.#routes = routes;
  }

  select(route: string, capability: ModelCapability, dataClass: DataClass): ModelRouteConfig {
    const config = this.#routes.find((candidate) => candidate.route === route);
    if (!config || !config.approved || config.provider.trim() === "" || config.model.trim() === "") {
      throw new ModelPolicyError("NO_APPROVED_ROUTE", `Route '${route}' is not explicitly approved`);
    }
    if (!config.capabilities.includes(capability) || CLASS_RANK[dataClass] > CLASS_RANK[config.dataClassCeiling]) {
      throw new ModelPolicyError("NO_APPROVED_ROUTE", `Route '${route}' is not approved for ${capability}/${dataClass}`);
    }
    if (config.approval !== "pre-approved") {
      throw new ModelPolicyError("APPROVAL_REQUIRED", `Route '${route}' requires interactive approval`);
    }
    if (config.timeoutMs <= 0 || config.tokenBudget <= 0 || config.retry.maxAttempts < 1 || config.retry.maxAttempts > 3 || config.retry.backoffMs < 0) {
      throw new ModelPolicyError("INVALID_CONFIG", `Route '${route}' has invalid execution limits`);
    }
    return config;
  }
}

export class ModelAdapter {
  readonly #providers: ReadonlyMap<string, ModelProvider>;
  readonly #router: ApprovedModelRouter;
  readonly #audit: AuditSink;
  readonly #now: () => Date;

  constructor(providers: readonly ModelProvider[], router: ApprovedModelRouter, audit: AuditSink, now = () => new Date()) {
    this.#providers = new Map(providers.map((provider) => [provider.provider, provider]));
    this.#router = router;
    this.#audit = audit;
    this.#now = now;
  }

  async generateStructured<T>(route: string, request: GenerationRequest, schema: RuntimeSchema<T>): Promise<T> {
    return (await this.#run(route, "structured", request, (provider, config, signal) =>
      provider.generateStructured(request, schema, config, signal))).value;
  }

  async generateDraft(route: string, request: GenerationRequest, schema: RuntimeSchema<unknown>): Promise<unknown> {
    const result = await this.#run(route, "draft", request, async (provider, config, signal) => {
      const raw = await provider.generateDraft(request, config, signal);
      try {
        return { ...raw, value: schema.parse(raw.value) };
      } catch {
        throw new ModelUnavailableError("SCHEMA_REJECTED", `Provider output failed ${schema.name}`);
      }
    });
    return result.value;
  }

  async #run<T>(
    route: string,
    capability: ModelCapability,
    request: GenerationRequest,
    invoke: (provider: ModelProvider, config: ModelRouteConfig, signal: AbortSignal) => Promise<ProviderRunResult<T>>,
  ): Promise<ProviderRunResult<T>> {
    const config = this.#router.select(route, capability, request.dataClass);
    const provider = this.#providers.get(config.provider);
    if (!provider) throw new ModelPolicyError("NO_APPROVED_ROUTE", `Approved provider '${config.provider}' is unavailable`);
    const started = this.#now();
    const runId = createHash("sha256").update(`${started.toISOString()}\0${request.job}\0${route}\0${request.inputRecordIds.join("\0")}`).digest("hex").slice(0, 20);
    let attempts = 0;
    try {
      let lastError: unknown;
      while (attempts < config.retry.maxAttempts) {
        attempts += 1;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), config.timeoutMs);
        try {
          const result = await invoke(provider, config, controller.signal);
          clearTimeout(timer);
          const outputHash = createHash("sha256").update(JSON.stringify(result.value)).digest("hex");
          await this.#audit.record(this.#auditRecord(runId, request, config, started, "succeeded", attempts, result.tokenCount, outputHash));
          return result;
        } catch (error) {
          clearTimeout(timer);
          lastError = controller.signal.aborted ? new ModelUnavailableError("TIMEOUT", "Model request timed out") : error;
          if (error instanceof ModelUnavailableError && error.code === "SCHEMA_REJECTED") break;
          if (attempts < config.retry.maxAttempts && config.retry.backoffMs > 0) await new Promise((resolve) => setTimeout(resolve, config.retry.backoffMs));
        }
      }
      throw lastError instanceof ModelUnavailableError
        ? lastError
        : new ModelUnavailableError("PROVIDER_FAILED", "Approved model route failed");
    } catch (error) {
      const code = error instanceof ModelUnavailableError ? error.code : "PROVIDER_FAILED";
      await this.#audit.record(this.#auditRecord(runId, request, config, started, "failed", attempts, undefined, undefined, code));
      throw error;
    }
  }

  #auditRecord(runId: string, request: GenerationRequest, config: ModelRouteConfig, started: Date, status: RunAudit["status"], attempts: number, tokenCount?: number, outputHash?: string, errorCode?: string): RunAudit {
    return {
      runId,
      job: request.job,
      route: config.route,
      provider: config.provider,
      model: config.model,
      promptVersion: request.promptVersion,
      inputRecordIds: [...request.inputRecordIds],
      dataClass: request.dataClass,
      startedAt: started.toISOString(),
      endedAt: this.#now().toISOString(),
      status,
      attempts,
      ...(tokenCount === undefined ? {} : { tokenCount }),
      ...(outputHash === undefined ? {} : { outputHash }),
      ...(errorCode === undefined ? {} : { errorCode }),
    };
  }
}
