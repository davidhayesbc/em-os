# ADR 0010: VS Code extension as first client; widget dashboard

- **Status:** Accepted
- **Date:** 2026-10-19
- **Spec:** §§5, 6, 11

## Context

The user wants a full-screen dashboard plus a cut-down, always-visible panel inside VS Code. The design should be visual (timelines, cards, chips, charts) rather than text-heavy. They want widgets such as team PR health, ticket health and observability graphs, and other users will want different ones. The UI must stay separate from the backend (ADR 0001).

## Decision

- **First client:** a VS Code extension, a thin client of the service API (`api-contract`). It holds no business logic and no data except UI state.
- **Lifecycle:** on activation the extension finds or starts the service (managed mode), then authenticates with the local token. It shows the connection state, and "service unavailable" if it can't connect.
- **Dashboard:** a `WebviewPanel` opened as an editor tab, with a responsive grid of widgets. The layout is stored in the service, so other clients could reuse it.
- **Sidebar:** a `WebviewView` in an EM OS activity-bar container, showing the next meeting, the top 3 items, the triage badge and progress.
- **Other views:** triage, Ask, person profile, meeting prep, end-of-day wrap, settings (including Models and Retention).
- **Widget registry:** `WidgetDefinition { id, title, defaultSize, query, component }`.
  - Queries are service API calls; widgets never talk to connectors.
  - Built-ins: header, week load, today timeline, do-these-5, waiting-on, PR health, ticket health, Ask entry.
  - Connectors may contribute widgets, e.g. observability metric graphs.
- **Webview security and styling:**
  - VS Code theme CSS variables only;
  - a strict Content Security Policy;
  - bundled assets only, with no remote scripts.
- **UI framework and charting library:** builder's choice, provided they're lightweight and bundled. The deprecated Webview UI Toolkit is not used.
- **Accessibility:** keyboard-complete, with ARIA labels.
- **Other clients:** a future web UI could be served by the service and reuse the same widget components, since they consume only the API. That's not in scope now.

## Alternatives considered

- **TreeViews only:** rejected as too text-heavy. They can be added later as an accessible fallback.
- **Logic in the extension:** rejected. It violates ADR 0001.

## Consequences

The webview bundle is a real front-end build, with component tests plus an extension smoke test. Widgets are testable against a fake API client.
