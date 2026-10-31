# Nama database per pabrik

| Instalasi | Database aplikasi | Database AI |
|---|---|---|
| Trangkil | sugarcane_trangkil | sugarcane_ai_trangkil |
| Malang | sugarcane_malang | sugarcane_ai_malang |

Link RTSP utama tersimpan pada tabel `cameras`, kolom `rtsp_url`, di database aplikasi pabrik. Salinan sinkronisasi layanan AI tersimpan pada `ai_cameras.rtsp_url` di database AI pabrik. Perubahan dilakukan melalui Konfigurasi Kamera; .env tidak menyimpan link RTSP.

Database Trangkil diganti nama dari sugarcane menjadi sugarcane_trangkil dan sugarcane_ai menjadi sugarcane_ai_trangkil dengan ALTER DATABASE RENAME. OID lama 16389 dan 17402 tetap sama; 10 tabel aplikasi dan 4 tabel AI dapat dibaca, dan link kamera masih tersimpan. User/role/password PostgreSQL tidak diganti. Malang tidak di-rename.

Konfigurasi .env/.env.example, guard API/Python AI, default POSTGRES_DB dan healthcheck Docker, serta dokumentasi telah disesuaikan. Nama volume/container Docker tetap dipertahankan agar perubahan nama database tidak membuat penyimpanan baru. Mengubah POSTGRES_DB saja tidak melakukan rename pada volume lama; rename pada server lokal sudah dilaksanakan.

Typecheck, build API, integrasi CRUD kamera pada schema sementara, dan koneksi Python API/AI sudah diverifikasi menggunakan nama baru. Health API/AI/gateway Malang tetap sehat. Bukti lokal ada di .deploy/trangkil-database-rename-verification.json.

DBeaver: pada masing-masing koneksi Trangkil, buka Edit Connection lalu ubah field Database menjadi sugarcane_trangkil atau sugarcane_ai_trangkil. Username, password, host dan port tetap. Reconnect setelah perubahan. Koneksi idle DBeaver ke nama lama dihentikan selama rename.
