# Database Malang

Dua database khusus: `sugarcane_malang` (akun, role, kamera, inspeksi) dan `sugarcane_ai_malang` (ROI, kamera AI, frame, agregasi). Server PostgreSQL dapat sama dengan Trangkil; konfigurasi lokal memakai 5433. Login `sugarcane_malang` terpisah dan bukan superuser.

`npm run db:setup` memerlukan koneksi administrator sementara, membuat hanya objek Malang dan menulis kredensial ke `.env`. `npm run db:migrate` menjalankan SQL 001?007 pada database Malang. AI menjalankan migrasi native saat startup. API/AI menolak nama database Trangkil.

Kamera aplikasi merupakan sumber konfigurasi utama. station=2 bukan berarti camera_id=2. Sinkronisasi AI menjaga ID sama dengan aplikasi dan hanya mengisi ROI kosong untuk station 2 dari referensi Malang. Riwayat dan ROI yang sudah ada tidak diimpor atau ditimpa oleh backup dua pabrik.

Backup/restore harus membatasi dua database Malang beserta snapshot Malang. Jangan menjalankan restore penuh `database-before-trangkil.json` ke database aktif.
