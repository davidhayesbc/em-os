# EM OS

An operating system for engineering managers. EM OS gathers what's happening across your chat, meetings, email, calendar, PRs, tickets and docs into one local, dated, searchable store. It tracks what you've promised and what others owe you, and shows the five things that matter today, fitted around your meetings. You can ask questions with answers that link back to sources, and draft updates and brag docs from a cited record.

> **Status:** Phase 0 (foundations) is done: the local service, SQLite store, API contract, CLI and a VS Code extension shell are in place, with no product features yet. See [`docs/DEVELOPING.md`](docs/DEVELOPING.md) to build and run it. The product is described in [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md), with decision records in [`docs/adr/`](docs/adr/README.md).

## Shape

- **A backend service** (`emosd`) owns the data, sync, pipelines and model routing.
- **Clients** attach to it: a VS Code extension first, plus a CLI, and Claude Code or any MCP client via EM OS's own MCP server.

## Principles

- **Local-first.** Your data lives in a SQLite file on your machine, never in this repo.
- **Pluggable.** Sources are connector plugins, usually backed by MCP servers you already use. Nothing is tied to one employer's tools.
- **Dated.** Everything has a date. Search is date-scoped first, and old material ages out or can be excluded.
- **Low noise.** Machine-found commitments land in a fast triage inbox that learns from your decisions.
- **Cited.** Every draft and answer links to the records it came from.
- **Right model per task.** Claude, an OpenAI-compatible gateway or local Ollama are auto-selected per job, by capability and data sensitivity, and you can override any choice.

## Developing

See [`docs/DEVELOPING.md`](docs/DEVELOPING.md) to install, run, debug and test the extension locally.

## Repository rules

This is a public repository. It holds code, docs and **synthetic** fixtures only. No real work content, credentials, databases or personal data is ever committed.

## Licence

[MIT](LICENSE)
