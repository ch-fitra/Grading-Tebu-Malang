# Sugarcane AI Platform

Web-first implementation of the Sugarcane grading console, prepared for one shared backend serving React Web, Electron Desktop, and Flutter Mobile.

## Current scope

- React + TypeScript + Vite web UI matching the reference application.
- Fastify + TypeScript REST/WebSocket API.
- RBAC terpusat: role developer, admin, operator, viewer, dan role kustom; halaman pengelolaan Users & Roles.
- PostgreSQL 16 persistence with an explicit SQL migration.
- Python FastAPI boundary for AI/ONNX inference.
- Electron desktop client that reuses the same built React UI and shared API.
- Flutter Android/iOS client sharing the same API, PostgreSQL-backed truck inspections, RBAC, and operational data.

## Repository layout

```text
apps/
  web/          React browser client (implemented now)
  api/          single business API for every client
  ai-service/   Python computer-vision inference boundary
  desktop/      Electron window and runtime API configuration
  mobile/       Flutter Android/iOS client
packages/
  contracts/    platform-neutral API types
database/
  postgres/     active PostgreSQL schema
  migrations/   legacy SQL Server reference from the audited app
docs/           architecture, API, analysis, and execution plan
models/         active/archive AI model files
storage/        snapshots, logs, and exports
```

Clients communicate only with `apps/api`. PostgreSQL and `apps/ai-service` are never accessed directly by Web, Electron, or Flutter.

## Run locally

Requirements: Node.js 22.12+, Python 3.10+, Docker Desktop (recommended).

```powershell
Copy-Item .env.example .env
npm install
npm run db:up
npm run db:migrate
pip install -r apps/ai-service/requirements.txt
npm run dev:web
```

Untuk menyalakan PostgreSQL, migrasi, API, AI service, Web, Electron Desktop, dan Flutter Mobile dengan satu perintah, hubungkan ponsel Android (opsional) lalu jalankan dari akar repo:

```powershell
npm run dev:all
```

Skrip memilih IP Wi-Fi/LAN komputer untuk mobile dan menjalankan Flutter bila perangkat Android terdeteksi. Jika belum ada perangkat, API/web/desktop tetap berjalan; sambungkan ponsel lalu ulangi perintah atau pasang APK yang sudah dibangun. PostgreSQL yang sudah berjalan akan dipakai; bila belum berjalan, Docker Desktop harus aktif agar skrip dapat menyalakannya.

Open `http://127.0.0.1:5175`. Local bootstrap accounts are `developer` / `developer` and `admin` / `admin`. Change these credentials and `JWT_SECRET` before any deployed use; see [access control](docs/access-control.md).

For the desktop UI, keep the shared API running and start `npm run dev:desktop` in another terminal. It builds and opens the same React interface in Electron without a Vite server. See [desktop setup](docs/desktop.md) for remote API configuration and packaging.

For mobile, run `flutter pub get` and `flutter run` inside `apps/mobile` while the same backend is running. Android Emulator uses `10.0.2.2:4110`; a physical phone needs the computer/server LAN IP and `API_HOST=0.0.0.0`. See [mobile setup](apps/mobile/README.md) for details.

PostgreSQL is mandatory. The API does not use an in-memory fallback or sample operational data; it fails fast when the database cannot be reached.

## Quality commands

```powershell
npm run typecheck
npm test
npm run test:integration
npm run test:ai
npm run build
npm audit
```

Tes integrasi memerlukan PostgreSQL dari `DATABASE_URL` dan memakai schema sementara yang terisolasi. Tes AI memerlukan dependensi Python; aktifkan `.venv` sebelum menjalankannya. Lihat [hasil pemeriksaan bug](docs/BUGFIX_VALIDATION.md).

See [project analysis](docs/PROJECT_ANALYSIS.md), [execution plan](docs/EXECUTION_PLAN.md), and [architecture](docs/architecture.md).
