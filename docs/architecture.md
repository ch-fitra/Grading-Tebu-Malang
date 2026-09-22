# Architecture

```text
React Web ───────┐
Electron + React ├── HTTPS / WebSocket ── Fastify API ── PostgreSQL
Flutter Mobile ──┘                            │
                                              ├── Python AI service
                                              ├── object/snapshot storage
                                              └── RTSP stream gateway (future)
```

## Non-negotiable boundaries

- `apps/api` owns authentication, authorization, grading rules, cameras, model metadata, truck sessions, audit history, reports, and persistence.
- `apps/ai-service` owns frame preprocessing and model inference only. It does not authenticate users or write business tables.
- `apps/web`, `apps/desktop`, and `apps/mobile` never connect directly to PostgreSQL or the AI service.
- Electron reuses the built React web application. Native device access belongs behind a narrow, context-isolated preload API or a local edge agent.
- Reusable wire types live in `packages/contracts`; UI components remain platform-specific.

## Deployment shapes

Central mode runs API, AI service, PostgreSQL, snapshot storage, and stream gateway on managed factory/server infrastructure. Web, desktop, and mobile connect to that same endpoint.

Offline edge mode may run Electron plus a local API/AI agent at a weighbridge and synchronize with the central service later. This must be treated as an explicit synchronization feature, not as direct database access from Electron.

## Folder ownership

Each feature should evolve vertically. In Web, new code belongs under `src/features/<feature>` with its components, queries, and tests. In API, split growing routes into `src/modules/<feature>` containing route, schema, service, and repository concerns. Cross-feature primitives belong in `src/shared`, not a generic dumping-ground `utils` directory.

## Data path

Camera/edge gateway produces frames; AI service returns normalized detections; API applies grading rules inside a transaction, stores metadata, associates captures with an inspection, and broadcasts an event. Every client refreshes from the API, so switching devices does not lose operational state.

