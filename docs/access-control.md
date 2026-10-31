# Akses pengguna dan role

Semua aturan akses ditegakkan di `apps/api`, bukan hanya dengan menyembunyikan menu web. Token login ditandatangani HMAC-SHA256, berlaku delapan jam, dan setiap request memuat ulang status user beserta izin role sehingga penonaktifan akun langsung berlaku. Password disimpan memakai `scrypt` dengan salt acak; nilai password tidak pernah dikirim oleh endpoint daftar user.

| Role bawaan | Tugas utama |
| --- | --- |
| Developer | Mengelola role, seluruh user, serta seluruh fungsi aplikasi. Role ini privat dan hanya terlihat oleh developer. |
| Admin | Mengelola user operasional, kamera, model, dan pengaturan; tidak dapat melihat, mengubah, atau membuat akun/role developer. |
| Operator | Melakukan inspeksi, membaca dashboard dan riwayat, melihat kamera/model. |
| Viewer | Hanya memantau dashboard, riwayat, kamera, dan model. |

Developer dapat membuat, mengubah, dan menghapus semua role selain `developer`, termasuk role awal Admin, Operator, dan Viewer. Role yang sedang dipakai user tidak dapat dihapus agar data akses tidak rusak. Admin hanya dapat membuat/mengubah user dengan izin operasional tanpa kemampuan mengelola user, role, model, atau pengaturan. Akun developer aktif terakhir tidak dapat dinonaktifkan/didemote.

Endpoint baru:

```text
POST   /api/auth/login
GET    /api/auth/me
GET    /api/roles
POST   /api/roles
PUT    /api/roles/:id
DELETE /api/roles/:id
GET    /api/users
POST   /api/users
PATCH  /api/users/:id
```

Migration: `database/postgres/002_rbac.sql` dan `003_role_visibility.sql`. Jalankan `npm run db:migrate` setelah memperbarui project. Backend tidak lagi memakai data memory atau endpoint inferensi contoh: PostgreSQL wajib aktif. Akun bootstrap hanya dibuat jika password diisi melalui `.env`; tidak ada password login bawaan. Semua akun pada instalasi ini mengakses PG Kebon Agung sesuai izin role, tanpa pemilihan pabrik berdasarkan username. Untuk produksi, isi secret dan password kuat, aktifkan `DATABASE_REQUIRED=true`, TLS, reverse proxy, rate limiting, serta audit log.

Menu **Konfigurasi Kamera** tersedia dengan `camera.read`. Tambah/edit/hapus/aktif/nonaktif/uji koneksi memerlukan `camera.write`. Pengguna dengan `camera.read`, termasuk Operator/Viewer, dapat membuka link RTSP lengkap melalui Lihat RTSP. Link dimasking pada daftar; perubahan tetap memerlukan `camera.write`. Penghapusan kamera yang memiliki riwayat ditolak; gunakan Nonaktifkan.
