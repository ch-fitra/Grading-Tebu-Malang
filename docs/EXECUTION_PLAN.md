# Execution plan and acceptance checklist

## Phase 1 — Audit (completed)

- Inventory runtimes, screens, UI states, APIs, database scripts, AI contract, assets, and desktop orchestration.
- Compare implementation with all supplied reference screenshots.
- Record architectural risks and data ownership boundaries.

## Phase 2 — Platform foundation (completed)

- Establish the `apps`, `packages`, `database`, `models`, `storage`, and `docs` boundaries.
- Select PostgreSQL and provide Docker, environment, schema, indexes, and seed records.
- Keep one Fastify API and one Python AI service for all present/future clients.
- Add shared TypeScript contracts and Electron/Flutter containers.

## Phase 3 — Web parity (completed)

- Preserve the reference login, dashboard, history, camera, model, settings, theme, responsive sidebar, modals, truck workflow, WebSocket refresh, and CSV export.
- Preserve the supplied branding asset and visual styling.
- Connect all server-backed features through the single API URL.

## Phase 4 — Verification (automated in this delivery)

- Install from the workspace lockfile.
- Type-check contracts, API, Web, and Electron.
- Produce production builds.
- Start API and Web, then smoke-test health, login, initial data, and static UI availability.

## Phase 5 — Electron desktop (implemented)

- Use the existing React UI as the Electron renderer, including all current screens and the access management UI.
- Package the React build with relative asset paths, and read the API address at desktop startup through a context isolated preload.
- Keep the desktop app as a client of the shared API. Development and packaged desktop do not start another backend or database.
- See [desktop plan](DESKTOP_PLAN.md) and [desktop setup](desktop.md) for the implementation and checks.

## Deferred by requested scope

- Flutter application implementation.
- Signed public desktop releases and distribution infrastructure.
- Real RTSP gateway, real ONNX model, production identity/security, and infrastructure deployment.
