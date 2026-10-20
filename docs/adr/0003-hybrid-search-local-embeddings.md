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
| `nomic-embed-text` | 768 | 16 | 80.7 | ~420 MiB |
| `nomic-embed-text` | 768 | 64 | 81.8 | ~426 MiB |
| `mxbai-embed-large` | 1024 | 16 | 36.1 | ~811 MiB |
| `mxbai-embed-large` | 1024 | 64 | 36.2 | ~815 MiB |

RSS sums the Ollama server and model runner processes and excludes the desktop app UI. On Apple Silicon, RSS may under-report model weights held in Metal/unified memory, so treat these figures as a lower bound.

### Decision

- **Default embedder: `nomic-embed-text`, dimension 768, batch size 64.** It is about 2.2x faster and uses about half the memory of `mxbai-embed-large`. Batch 16 and 64 differ by under 3%, so the batch size is not critical; 64 means fewer round trips. `mxbai-embed-large` (1024 dimensions) stays selectable as the configurable alternative. Retrieval quality was not evaluated in this spike; throughput and memory only.
- **Initial index:** 100k chunks takes about 20 minutes at ~80 chunks/s, so reindexing runs as a visible background task.

### Brute-force cosine

50,000 L2-normalised Float32 vectors, top-50, plain loop over one contiguous `Float32Array`, run in a `worker_threads` Worker. Median of 9 runs: **25 ms at 768 dimensions** (146 MiB matrix) and 31.7 ms at 1024 dimensions (195 MiB). The target is < 300 ms (spec §13), met with roughly 10x headroom, which confirms that `sqlite-vec` is not needed at this scale. Only the in-memory scan was timed. Loading vectors from SQLite BLOBs and date-filtered subsets were not measured. The scan is linear in the number of vectors, so 100k vectors extrapolates to roughly 50 ms at 768 dimensions (292 MiB) before BLOB-load cost; the date pre-filter makes the scanned set smaller in practice.

### Embedder contract (requirements for the Phase 3 adapter)

Verified empirically against Ollama 0.40.6 unless marked "per model card".

- **Embedder id to stamp on chunks:** `ollama:nomic-embed-text:latest@0a109f422b47` (provider, model tag, first 12 hex characters of the model digest). Full digest: `0a109f422b47e3a30ba2b10eca18548e944e8a23073ee3f3e947efcf3c45e59f`. For the alternative: `ollama:mxbai-embed-large:latest@468836162de7` (digest `468836162de7f81e041c43663fedbbba921dcea9b9fefea135685a39b2d83dd8`). Read the digest from `GET /api/tags` at startup so a re-pulled model with new weights triggers a reindex. Dimension is 768 for nomic and 1024 for mxbai.
- **Normalisation:** `/api/embed` returns L2-normalised vectors (norm 1.000000 on every vector checked, both models). Cosine can therefore be a plain dot product. The adapter should still normalise defensively, since an OpenAI-compatible embedder may not.
- **Context length and truncation:** nomic-embed-text has a 2048-token context. mxbai-embed-large has only 512 tokens. By default (`truncate: true`) over-length input is silently cut to the context length with no error (`prompt_eval_count` caps at 2048 and 512 respectively), so the tail is ignored. With `truncate: false` the call fails with HTTP 400 `the input length exceeds the context length`. The adapter must pass `truncate: false` and treat that error as a chunking bug, so overflow is never silent. The 300–500-token chunking target fits nomic; with mxbai it leaves little margin, so a chunk near 500 tokens plus a prefix can overflow, and the chunker must take a per-embedder max-token setting.
- **Task prefixes (per model card, not verified for retrieval quality here):** nomic-embed-text needs `search_document: ` before every chunk and `search_query: ` before every query. mxbai-embed-large needs no document prefix; queries use `Represent this sentence for searching relevant passages: `. The adapter must apply these, and prefix tokens count toward the context limit.
- **Cold vs warm:** the first request after unload took ~0.3–0.4 s (model load ~0.26–0.27 s); warm single-chunk requests took 15–27 ms. The default `keep_alive` is 5 minutes, confirmed from `/api/ps`. Set `keep_alive` to a longer value (e.g. `30m`) during interactive use and during reindexing, so Ask queries do not pay a cold load, and expect a ~0.5 s first-query penalty after idle.
- **Windows re-run:** rerun the bench and record chunks/s (Ollama uses CPU or an available GPU, so it will differ), RSS (the bench reads RSS via `ps`, which is absent there, so it reports `NaN`; read `ollama.exe` and the runner from Task Manager or `Get-Process ollama*` instead), and the cosine median. The cosine test needs no Ollama and runs with `MODELS= COSINE_RUNS=9`.
