# PG Trangkil: status dan pemasangan server

Workflow hanya berjalan pada push ke `production`. Runner harus tetap hidup melalui `C:\actions-runner\run.cmd`; konfigurasi ini tidak memasang service Windows dan tidak otomatis hidup sesudah reboot.

## Tahap pertama: pasang pengendali tanpa menghentikan layanan

Salin folder `scripts/cicd` dari laptop pengembangan ke folder proyek server yang sama. Jangan menyalin `.env`, database, `.runtime`, atau konfigurasi model dari laptop pengembangan.

Di PowerShell biasa **pada server**, jalankan:

```powershell
Set-Location 'C:\Users\Axioo Pongo\Documents\XOORA\AI-Grading-Sugarcane'
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\cicd\setup-server.ps1 -AdoptCurrentProcesses
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\cicd\check-server.ps1
```

`AdoptCurrentProcesses` mencatat proses Node pada 4110 dan Python pada 8010 sebagai proses instalasi ini. Jalankan hanya sesudah memastikan kedua port memang digunakan aplikasi Trangkil. Identitas lengkap termasuk waktu pembuatan diperiksa sebelum penghentian. Berkas identitas berada di `.deploy/processes.json` dan jangan dibagikan. Jika proses dihidupkan ulang secara manual, ulangi adopsi sebelum deployment.

## Pembaruan pertama belum boleh dilakukan otomatis

Server masih versi 05371a8, dengan kamera Malang ID 1 dan Trangkil ID 2. Jangan menghapus atau menukar ID berdasarkan asumsi. Pembaruan pertama memerlukan backup kedua database, inventaris kamera/model/data historis, peninjauan migrasi SQL, dan uji restore pada database terpisah. CI/CD tidak menghapus data Malang dan tidak menjalankan migrasi otomatis.

Deployment akan tetap ditolak apabila perubahan menyentuh skema database, repositori DB Python, dependensi Python, konfigurasi model atau ROI. Ini batas implementasi saat ini; perubahan tersebut perlu prosedur migrasi tersendiri. Jangan menghapus pemeriksaan untuk memaksa lolos.

## Deployment rutin setelah baseline server diperbarui

Selesaikan semua inspeksi dan minta operator tidak memulai inspeksi baru selama deployment. Pemeriksaan idle bukan kunci global yang mencegah operator memulai inspeksi setelah pemeriksaan.

Jalankan preflight dari workspace runner dengan GITHUB_WORKSPACE berisi checkout commit target dan ExpectedSha SHA lengkap. Preflight memvalidasi identitas commit, hooks, perubahan terlarang, kebersihan Git, pg_dump dan inspeksi aktif; fetch Git lokal dilakukan, layanan tidak dihentikan. Setelah lolos, push production menjalankan build dan paket desktop di GitHub, kemudian backup dan deployment di runner Windows.

Backup `.env`, konfigurasi ROI/model dan database disimpan di `.deploy/backups`. Direktori ini mengandung data sensitif dan belum dienkripsi. File inspeksi/model biner tetap di lokasi asal; deployment tidak menjalankan git clean/reset dan bukan pengganti backup disk.

Rollback mengembalikan commit dan konfigurasi, memasang ulang npm, membangun ulang dan memulai aplikasi. Rollback membutuhkan jaringan/dependensi yang tersedia, tidak memulihkan database otomatis, dan belum diuji pada server Pongo. API serta AI diperiksa melalui health endpoint; ini belum membuktikan kamera Trangkil terhubung atau inferensi model berhasil. DNS publik tetap harus diperiksa terpisah.

Installer desktop tersedia sebagai artifact Actions; aplikasi desktop pengguna tidak diperbarui otomatis.
