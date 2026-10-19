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
