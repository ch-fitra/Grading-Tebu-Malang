# Deployment

For shared multi-client operation, deploy Web, API, AI service, PostgreSQL, snapshot/object storage, and the future stream gateway as separate services. Terminate TLS at a reverse proxy and expose only Web/API/WebSocket endpoints to clients.

Electron is a client of that deployment. It must not start its own central database. The current development orchestrator may start local services to support offline workstation development.

Required production controls include `DATABASE_REQUIRED=true`, non-default secrets, hashed database-backed users, restrictive CORS, TLS, backups, audit retention, health/readiness probes, and model/snapshot volume management.

Build artifacts are produced with:

```powershell
npm run build
```

Container/deployment manifests beyond local PostgreSQL are intentionally deferred until the target factory infrastructure is known.

