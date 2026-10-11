# Database

Proyek menggunakan dua database PostgreSQL:

- `sugarcane`: data aplikasi, akun, role, kamera, inspeksi, dan persetujuan. Koneksi menggunakan `DATABASE_URL`.
- `sugarcane_ai`: konfigurasi kamera/model AI, frame deteksi, dan ringkasan siklus. Koneksi menggunakan `AI_DATABASE_URL`.

## Database aplikasi

Migrasi aktif berada di `database/postgres/` (001 sampai 005):

```powershell
npm run db:up
npm run db:migrate
```

`db:up` hanya diperlukan jika memakai Docker Compose. PostgreSQL wajib tersedia sebelum API dijalankan. Sesuaikan host, port, nama database, dan kredensial pada `.env` bila memakai server sendiri.

## Database AI

Service AI menjalankan migrasi dari `apps/ai-service/db/migrations.py` saat startup. Service mencoba membuat `sugarcane_ai` jika belum tersedia. User membutuhkan izin membuat database, atau administrator harus menyiapkannya sebelum startup.

Frame dan siklus tersimpan melalui `apps/ai-service/db/repository.py`. Snapshot lokal berada di `apps/ai-service/storage/snapshots/`; konfigurasi model berada di `apps/ai-service/models/active/config.json`.

## Pemeliharaan

Backup kedua database beserta model, konfigurasi ROI, dan snapshot yang diperlukan. `npm run db:down` menghentikan database Docker tanpa menghapus volume. Hindari `docker compose down -v` kecuali memang ingin menghapus seluruh data volume.

Tes integrasi menggunakan schema sementara; jalankan pada database pengembangan dengan izin yang sesuai. Referensi SQL Server lama tidak digunakan oleh runtime PostgreSQL.
