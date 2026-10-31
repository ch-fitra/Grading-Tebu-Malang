# RTSP sebagai konfigurasi database

Sumber utama adalah `cameras.rtsp_url` pada database aplikasi instalasi ini, lalu disinkronkan ke `ai_cameras` pada database AI. Tidak ada pembacaan RTSP dari environment atau pembuatan kamera otomatis saat startup. Kamera operasional lama dipertahankan.

Melalui Konfigurasi Kamera:

- Read: pengguna dengan camera.read dapat membuka link lengkap lewat Lihat RTSP.
- Create/Update/Delete: pengguna dengan camera.write dapat mengelola kamera, link, station dan status.
- Kamera dengan siklus aktif tidak dapat diubah/dihapus. Kamera bersejarah harus dinonaktifkan untuk menjaga relasi riwayat.
- Link tampak tersamarkan pada daftar; dialog baca menampilkan link yang tersimpan tanpa memerlukan hak edit.
- API tanpa login tidak mengembalikan data kamera.

Demo: dua database aplikasi dan dua database AI terpisah untuk kedua pabrik pada server yang sama. Produksi: database pabrik terkait dipindahkan ke server pabriknya dan koneksi database pada .env disesuaikan. RTSP diatur dari aplikasi setelah restore jika alamat jaringan kamera berubah. .env.example tidak memuat variabel RTSP.

Schema SQL sudah memiliki kolom rtsp_url, sehingga tidak diperlukan perubahan struktur tabel untuk pemindahan sumber konfigurasi ini. Backup historis tidak dibaca oleh aplikasi. Pengujian CRUD memakai schema sementara dengan AI mock dan tidak menghubungkan kamera fisik.

## Hasil verifikasi implementasi

- Build dan TypeScript API/web/desktop lolos pada kedua proyek.
- Flutter analyze kedua proyek lolos; form mobile mengirim station dan mempertahankan status enabled.
- Integrasi API/schema sementara: autentikasi, read RTSP sesuai camera.read, CRUD sesuai camera.write, validasi URL, station unik, sinkronisasi AI mock, proteksi siklus aktif/riwayat, serta tidak membuat ulang kamera setelah dihapus.
- Uji peramban pada kedua proyek: pembaca dapat membuka link penuh pada layar 1440 dan 900 piksel, sedangkan tombol tambah/edit mengikuti hak akses.
- Tidak ada RTSP pada .env dan .env.example aktif; tidak ada pembacaan variabel RTSP pada kode operasional.
- Guard identitas database menolak konfigurasi yang menunjuk ke database pabrik lain.
- Kamera operasional kedua pabrik tetap tersimpan; pengujian CRUD tidak mengubah kamera fisik.

Layanan Malang dimuat ulang setelah pemeriksaan idle dan diverifikasi sehat pada API 4111, AI 8011, gateway 8081. Operator Malang dapat membaca link yang sama persis dengan database. Trangkil tidak sedang berjalan saat penerapan; build baru digunakan saat startup berikutnya. Arsip backup historis dipertahankan sebagai arsip pasif, bukan konfigurasi aktif.

Nama database Trangkil telah diperbarui menjadi sugarcane_trangkil dan sugarcane_ai_trangkil. Detail lokasi RTSP dan reconnect DBeaver: [database-names.md](database-names.md).
