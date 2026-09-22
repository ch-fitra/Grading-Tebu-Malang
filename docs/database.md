# Database

PostgreSQL is the active database target. The repeatable schemas are in `database/postgres/001_initial.sql`, `002_rbac.sql`, and `003_role_visibility.sql`; they cover operational data plus users, roles, and permissions. No camera, model, inference, or inspection example data is inserted.

```powershell
npm run db:up
npm run db:migrate
```

Set `DATABASE_REQUIRED=true` outside local UI development so the API fails fast instead of using its volatile fallback repository.

`DATABASE_REQUIRED=true` is also the default in this project: the API will not start without PostgreSQL. The Docker configuration uses port `5432`; this workstation's installed PostgreSQL service uses port `5433`, so its local `.env` is configured separately.

`database/migrations/001_initial.sql`, `database/seed/seed.sql`, and `docs/sql-server-ssms.md` are retained only as audited SQL Server reference material. They are not executed by the PostgreSQL workflow.
