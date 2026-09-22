# Audit of the reference Sugarcane project

## What was found

The reference is a functional industrial-console prototype with four runtimes: React/Vite UI, Fastify API, Electron orchestrator, and Python FastAPI AI adapter. Its visual system is unusually complete: responsive collapsed/expanded navigation, light/dark themes, branded login, status headers, KPI cards, five line selectors, stream empty states, truck inspection workflow, detection/truck history, filtering, CSV export, camera CRUD, model activation, and environment settings.

The screenshots and source agree on the key design tokens: deep green shell, off-white grid surfaces, green primary actions, compact condensed labels, rounded cards, restrained borders/shadows, and operational status badges. The complete web source and assets were therefore retained instead of visually approximating them.

## Risks in the reference

1. The API stored cameras, models, and detections in process memory, so all state vanished on restart.
2. Truck sessions lived only in browser localStorage, preventing shared Web/Desktop/Mobile state.
3. API implementation was concentrated in one route file, increasing coupling as features grow.
4. Shared request/response contracts were duplicated between client and server.
5. Authentication returned a development token and stored a plain configurable password; it is not production security.
6. Electron started all services itself, which is useful for an offline station but must not be the deployment model for centralized multi-client operation.
7. The SQL Server script and in-memory runtime disagreed, and no repeatable PostgreSQL development environment existed.

## Decisions for this repository

- PostgreSQL is the primary database because it is cross-platform, transactional, mature, and easy to reproduce with Docker. SQL Server can remain a future repository adapter if required by the factory.
- Fastify/TypeScript remains the sole business backend. Python is isolated to AI inference.
- React remains shared between browser and the Electron renderer; there is no duplicated desktop UI.
- Flutter will consume the same versioned API and WebSocket events; it never shares React UI code, only contracts and product behavior.
- SQL migration files remain explicit and reviewable. The API reports whether PostgreSQL or the development fallback is active.
- `packages/contracts` is the start of the platform contract layer; an OpenAPI-generated Dart client should be added when Flutter work begins.

## Recommended next production increments

Replace the development login with Argon2 password hashing, JWT access/refresh tokens, role checks, audit events, and rate limiting. Move truck inspection persistence fully from localStorage to the API. Add RTSP-to-HLS/WebRTC gateway support because browsers cannot play RTSP directly. Store snapshots in S3-compatible object storage and only paths/metadata in PostgreSQL. Add OpenAPI, integration tests with a disposable PostgreSQL container, structured logs, metrics, and backup/restore procedures.

