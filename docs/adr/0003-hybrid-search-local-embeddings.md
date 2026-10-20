# ADR 0003: Date-scoped hybrid search with local embeddings

- **Status:** Accepted
- **Date:** 2026-10-19
- **Spec:** §§5.4, 7.6–7.8

## Context

Ask ("what did we decide about the ledger migration last month?") needs semantic recall across notes, threads, transcripts and documents, including brag docs shared with the user, with links back to sources. Old material must not drown recent material, so retrieval is date-scoped first (ADR 0004). Embeddings also power commitment dedup and few-shot retrieval of past triage decisions. The scale is roughly 10k–100k chunks.

## Decision

- **Embedder port:** `EmbeddingProvider.embed(texts[]) → Float32Array[]`, reporting `{id, dimension}`. The default is Ollama on loopback with a configurable model, benchmarked in Phase 0. An OpenAI-compatible embedder (e.g. via a LiteLLM gateway) can also be selected, subject to that embedder's data approval (ADR 0006).
- **Chunking:** structure-aware, ~300–500 tokens:
  - Markdown and docs by heading or section;
  - threads by message group;
  - transcripts by speaker turns;
  - brag docs by entry.

  Chunks inherit `occurred_at` from their item or section and carry their own sensitivity.
- **Retrieval pipeline:**
  1. resolve the time scope (ADR 0004);
  2. SQL pre-filter by date range, retention state, exclusion rules and sensitivity policy;
  3. FTS5 BM25 top-k and brute-force cosine top-k within the filtered set, run in a worker thread;
  4. reciprocal rank fusion with an optional recency-decay term;
  5. return chunks plus owner records and source URLs.
- **Reindex:**
  - vectors are stamped with embedder id and dimension;
  - changing the embedder triggers a background reindex;
  - vectors from different embedders are never compared.
- **Degraded mode:** if the embedder is unavailable, keyword search still works and the UI says "semantic search unavailable".

## Alternatives considered

- **Full-text search only:** rejected. Paraphrased questions over transcripts are the core Ask use case.
- **A vector extension (`sqlite-vec`):** deferred. It's a native packaging risk. Brute force after the date pre-filter is fast at this scale.
- **Hosted embeddings by default:** rejected. Local is the default for privacy and cost, and hosted remains available through the port.

## Consequences

Semantic features need Ollama or another configured embedder; onboarding checks for one. Reindexing takes minutes and runs as a visible background task. Date pre-filtering keeps brute-force search cheap as history grows.

## Spike result (2026-10-19)

Benchmark: `spikes/s5-ollama/bench.ts` (`node --experimental-strip-types spikes/s5-ollama/bench.ts`, no dependencies). It sends 2,000 synthetic English chunks (~375 tokens each) to `POST /api/embed` with `input: string[]`. Hardware: Apple M5 Pro, macOS, Ollama 0.40.6, Node 26.4 (Node 24 is the supported runtime but was not installed on the bench machine). Throughput was measured on one machine only; treat it as an order of magnitude.

| Model | Dimension | Batch | Chunks/s | Ollama RSS (peak, server + runner) |
| --- | --- | --- | --- | --- |
| `nomic-embed-text` | 768 | 16 | 64.1 | ~502 MiB |
| `nomic-embed-text` | 768 | 64 | 79.3 | ~504 MiB |
| `mxbai-embed-large` | 1024 | 16 | 32.0 | ~890 MiB |
| `mxbai-embed-large` | 1024 | 64 | 35.2 | ~893 MiB |

- **Default embedder: `nomic-embed-text`, dimension 768, batch size 64.** It is about twice as fast and uses about 45% less memory than `mxbai-embed-large`, and its larger vectors buy nothing we have measured. `mxbai-embed-large` (1024 dimensions) stays selectable as the configurable alternative. Retrieval quality was not evaluated in this spike; throughput and memory only.
- **Initial index:** 100k chunks takes about 21 minutes at ~79 chunks/s, so reindexing runs as a visible background task. Batch 64 is about 20% faster than batch 16 for `nomic-embed-text`; larger batches were not tried.
- **Brute-force cosine:** 50,000 L2-normalised Float32 vectors, top-50, plain loop over one contiguous `Float32Array`, run in a `worker_threads` Worker. Median of 9 runs: **23.8 ms at 768 dimensions** (146 MiB matrix) and 32.0 ms at 1024 dimensions (195 MiB). The target is < 300 ms (spec §13), met with roughly 10x headroom, which confirms that `sqlite-vec` is not needed at this scale. The matrix size is the full 50k set; after the date pre-filter the working set is smaller.
- **Windows re-run:** on Windows x64, rerun the bench and record chunks/s (Ollama uses CPU or an available GPU, so it will differ), RSS (the bench reads RSS via `ps`, which is absent there, so it reports `NaN`; read `ollama.exe` and the runner from Task Manager or `Get-Process ollama*` instead), and the cosine median. The cosine test needs no Ollama and runs with `MODELS= COSINE_RUNS=9`.
