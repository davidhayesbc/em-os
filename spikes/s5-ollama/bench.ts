// Spike S5: Ollama embedding throughput + brute-force cosine timing.
// Run: node --experimental-strip-types spikes/s5-ollama/bench.ts   (Node >= 24; no dependencies)
// Env: OLLAMA_URL (default http://127.0.0.1:11434), MODELS (comma list), CHUNKS (default 2000),
//      COSINE_N (default 50000), COSINE_RUNS (default 9).
import { execFileSync } from "node:child_process";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

const WORDS =
  "the of and to in a is that for it as was with be by on not he this are or his from at which but have an had they you were their one all we can her has there been if more when will would who so no".split(
    " ",
  );
const TOPICS =
  "ledger migration retention budget roadmap incident review hiring calibration onboarding latency service queue deploy rollback sprint planning estimate dependency backlog threshold policy owner decision risk mitigation schedule capacity quarter metric dashboard alert pipeline schema index cache vector search".split(
    " ",
  );

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** ~373 English words (~375 tokens with the BERT-style tokenizers used here) per chunk. */
function makeChunks(count: number): string[] {
  const rand = rng(42);
  const pick = (list: string[]) => list[Math.floor(rand() * list.length)] as string;
  const chunks: string[] = [];
  for (let i = 0; i < count; i++) {
    const sentences: string[] = [];
    let words = 0;
    while (words < 365) {
      const len = 8 + Math.floor(rand() * 10);
      const parts: string[] = [];
      for (let w = 0; w < len; w++) parts.push(rand() < 0.35 ? pick(TOPICS) : pick(WORDS));
      const s = parts.join(" ");
      sentences.push(`${s.charAt(0).toUpperCase()}${s.slice(1)}.`);
      words += len;
    }
    chunks.push(`Chunk ${i}. ${sentences.join(" ")}`);
  }
  return chunks;
}

const base = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";

async function embed(model: string, input: string[], keepAlive?: number): Promise<number[][]> {
  const res = await fetch(`${base}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      input,
      ...(keepAlive === undefined ? {} : { keep_alive: keepAlive }),
    }),
  });
  if (!res.ok) throw new Error(`embed ${model}: HTTP ${res.status} ${await res.text()}`);
  return ((await res.json()) as { embeddings: number[][] }).embeddings;
}

/** Sum of RSS (MiB) across the Ollama server and its model runner processes (not the desktop app UI). */
function ollamaRssMiB(): number {
  try {
    const out = execFileSync("ps", ["-axo", "rss=,comm="], { encoding: "utf8" });
    let kib = 0;
    for (const line of out.split("\n")) {
      const m = /^\s*(\d+)\s+(.*)$/.exec(line);
      const name = (m?.[2] ?? "").split(/[\\/]/).pop()?.toLowerCase() ?? "";
      if (m && /^(ollama|llama-server|ollama_llama_server)(\.exe)?$/.test(name))
        kib += Number(m[1]);
    }
    return kib / 1024;
  } catch {
    return Number.NaN; // e.g. Windows: use Task Manager / Get-Process ollama*
  }
}

async function benchModel(model: string, chunks: string[], batchSizes: number[]) {
  const results: Record<string, unknown> = { model };
  const warm = await embed(model, chunks.slice(0, 16));
  results.dimension = warm[0]?.length;
  for (const batch of batchSizes) {
    let peak = 0;
    const timer = setInterval(() => {
      peak = Math.max(peak, ollamaRssMiB());
    }, 250);
    const t0 = performance.now();
    let n = 0;
    for (let i = 0; i < chunks.length; i += batch) {
      n += (await embed(model, chunks.slice(i, i + batch))).length;
    }
    const secs = (performance.now() - t0) / 1000;
    clearInterval(timer);
    peak = Math.max(peak, ollamaRssMiB());
    results[`batch${batch}`] = {
      chunks: n,
      seconds: Number(secs.toFixed(1)),
      chunksPerSec: Number((n / secs).toFixed(1)),
      peakOllamaRssMiB: Math.round(peak),
    };
    console.log(model, `batch=${batch}`, results[`batch${batch}`]);
  }
  await embed(model, [], 0).catch(() => undefined); // unload so the next model's RSS is clean
  return results;
}

// ---- brute-force cosine in a worker thread ----
type CosineJob = { dim: number; n: number; runs: number; k: number };

function cosineWorker({ dim, n, runs, k }: CosineJob) {
  const rand = rng(7);
  const data = new Float32Array(n * dim); // contiguous, L2-normalised rows
  for (let r = 0; r < n; r++) {
    let norm = 0;
    const o = r * dim;
    for (let d = 0; d < dim; d++) {
      const v = rand() * 2 - 1;
      data[o + d] = v;
      norm += v * v;
    }
    norm = Math.sqrt(norm);
    for (let d = 0; d < dim; d++) data[o + d] = (data[o + d] as number) / norm;
  }
  const query = data.slice(0, dim);
  const times: number[] = [];
  for (let run = 0; run < runs; run++) {
    const t0 = performance.now();
    const scores = new Float32Array(k).fill(-2);
    const ids = new Int32Array(k).fill(-1);
    let minIdx = 0;
    for (let r = 0; r < n; r++) {
      const o = r * dim;
      let dot = 0;
      for (let d = 0; d < dim; d++) dot += (data[o + d] as number) * (query[d] as number);
      if (dot > (scores[minIdx] as number)) {
        scores[minIdx] = dot;
        ids[minIdx] = r;
        minIdx = 0;
        for (let i = 1; i < k; i++)
          if ((scores[i] as number) < (scores[minIdx] as number)) minIdx = i;
      }
    }
    times.push(performance.now() - t0);
    if (ids[0] === -1) throw new Error("no results");
  }
  return { dim, n, k, bytes: data.byteLength, timesMs: times.map((t) => Number(t.toFixed(1))) };
}

function runCosine(job: CosineJob): Promise<ReturnType<typeof cosineWorker>> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL(import.meta.url), { workerData: job });
    w.once("message", resolve);
    w.once("error", reject);
  });
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;

if (!isMainThread) {
  parentPort?.postMessage(cosineWorker(workerData as CosineJob));
} else {
  const chunks = makeChunks(Number(process.env.CHUNKS ?? 2000));
  const words = chunks.reduce((s, c) => s + c.split(" ").length, 0) / chunks.length;
  console.log(`node ${process.version}; ${chunks.length} chunks, avg ${words.toFixed(0)} words`);
  const models = (process.env.MODELS ?? "nomic-embed-text,mxbai-embed-large")
    .split(",")
    .filter(Boolean);
  const out: unknown[] = [];
  for (const m of models) {
    for (const other of models) await embed(other, [], 0).catch(() => undefined); // start from nothing loaded
    try {
      out.push(await benchModel(m, chunks, [16, 64]));
    } catch (e) {
      console.log(`model ${m} failed:`, (e as Error).message);
    }
  }
  const dims = new Set(
    out.map((r) => (r as { dimension?: number }).dimension).filter((d): d is number => !!d),
  );
  if (dims.size === 0) dims.add(768);
  for (const dim of dims) {
    const r = await runCosine({
      dim,
      n: Number(process.env.COSINE_N ?? 50000),
      runs: Number(process.env.COSINE_RUNS ?? 9),
      k: 50,
    });
    console.log(
      `cosine dim=${dim} n=${r.n} top-${r.k}: median ${median(r.timesMs)} ms, runs ${r.timesMs.join(", ")}; matrix ${(r.bytes / 1048576).toFixed(0)} MiB`,
    );
  }
}
