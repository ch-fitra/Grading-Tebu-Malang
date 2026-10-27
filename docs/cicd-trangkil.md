# CI/CD PG Trangkil — paket implementasi awal (27 Oktober 2026)

## Status dan keterbatasan

Paket ini dibuat berdasarkan transkrip proyek, **bukan berdasarkan pembacaan langsung repositori**. Repositori `ch-fitra/AI-Grading-Sugarcane` tidak dapat diakses dari koneksi GitHub pada sesi ini. Oleh karena itu, skrip belum bisa diuji pada source dan server asli. Paket ini sengaja *fail closed* dan **jangan langsung push ke branch `production`**.

Dari riwayat: runner Windows `trangkil-production` sudah menampilkan `Listening for Jobs`; server berada di `C:\Users\Axioo Pongo\Documents\XOORA\AI-Grading-Sugarcane`; Git server saat pemeriksaan berada di branch `main` pada commit `05371a8`. Layanan lokal sebelumnya menjawab `http://127.0.0.1:8080/health`. Port 4110 (API), 8010 (AI), 8080 (gateway), dan 5432 (PostgreSQL) dipakai saat diagnosis. CCTV kedua dan resolusi DNS domain sempat bermasalah.

## Isi dan perilaku

- `.github/workflows/deploy-trangkil.yml`: pemicu **hanya push ke `production`**. Build, typecheck, dan paket desktop di Windows hosted runner; upload installer. Deployment berikutnya di runner Windows `trangkil-production`.
- `scripts/cicd/deploy-trangkil.ps1`: preflight, backup `.env` dan **kedua URL database** (`pg_dump`), pindah ke commit yang telah diverifikasi, install/build, stop/start melalui dua hook operasional khusus server, cek health lokal, dan rollback kode ketika gagal.
- `scripts/cicd/check-server.ps1`: inspeksi awal tanpa memaparkan kredensial.
- `scripts/cicd/stop.example.ps1` dan `start.example.ps1`: template sengaja berhenti dengan error sampai mekanisme layanan nyata ditetapkan.

**Perlindungan:** perintah tidak menyentuh branch `main`, tidak menjalankan migrasi database otomatis, tidak membersihkan `.runtime`, tidak melakukan `git clean`, tidak menghapus database, model, snapshot atau konfigurasi kamera. Deployment ditolak jika Git mendeteksi perubahan pada migrasi/database, model aktif atau jalur konfigurasi terlindungi. Deployment juga ditolak jika Git melacak `.env`, `.runtime`, `.deploy`, `backup/malang`, atau folder model aktif. Untuk perubahan skema, lakukan prosedur manual dengan backup dan rollback yang sesuai.

## Cara memasang satu kali

1. Salin `.github/workflows/deploy-trangkil.yml` dan folder `scripts/cicd` ke root repository **di laptop pengembangan terlebih dahulu**. Review perubahan dalam branch uji sebelum merge/push ke `production`.
2. Pastikan package.json memang menyediakan `typecheck`, `build`, dan `package -w @sugarcane/desktop`. Pastikan `npm ci` lulus, dan `package-lock.json` diperbarui. Paket ini **tidak** mengaktifkan `test:cameras` di runner hosted karena belum diverifikasi kebutuhan database sementara serta AI mock-nya.
3. Di laptop server, jalankan `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\cicd\check-server.ps1` dari root proyek setelah script tersalin. Periksa juga apakah `.env` berisi `DATABASE_URL` dan `AI_DATABASE_URL` tanpa mengirim nilainya.
4. Di **server** buat folder `.deploy` yang tidak dilacak Git. Salin dua contoh hook ke `.deploy\stop.ps1` dan `.deploy\start.ps1`, lalu **sesuaikan dengan cara API dan AI saat ini dijalankan**. Jangan menggunakan `Stop-Process -Name node/python` secara global. Hook stop harus menyelesaikan atau menolak deployment jika inspeksi aktif. Hook start harus menyalakan layanan nonblocking dan kembali ke pemanggil. Untuk verifikasi, pelajari `scripts/start-public.ps1`, `scripts/resume-public.ps1` dan task scheduler/service manager server, lalu uji manual saat jendela maintenance.
5. Tempatkan `.deploy/` di `.git/info/exclude` khusus salinan server (atau `.gitignore` di repository). Batasi akses ke `.deploy/backups/`: isinya salinan database dan `.env` yang sensitif. Simpan salinan tambahan di tempat aman dan tetapkan retensi backup.
6. Pastikan `pg_dump.exe` PostgreSQL 18 tersedia (`C:\Program Files\PostgreSQL\18\bin\pg_dump.exe` atau dalam PATH), kredensial dapat membuat dump, dan disk cukup. Implementasi ini memakai password dari PostgreSQL URI yang berada dalam `.env` dan tidak mencetaknya.
7. Sinkronkan Git server dengan versi aplikasinya (working tree bersih) dan pastikan runner `trangkil-production` online. Karena runner sebelumnya dijalankan dengan `run.cmd` dan bukan service, PowerShell runner harus tetap hidup; setelah restart jalankan manual lagi.
8. **Uji kering dari checkout GitHub Actions** (atau salinan checkout branch uji dengan `GITHUB_WORKSPACE` ditetapkan), menggunakan `-PreflightOnly`, setelah hook disiapkan. Test berikutnya push percobaan ke branch `production` saat jendela maintenance dengan database sudah dicadangkan dan ada akses pemulihan.

## Operasional dan risiko yang belum selesai

- Workflow **tidak akan langsung berjalan** hanya dengan mengunduh ZIP. File perlu ditempatkan dan di-commit ke repository `production`; server hooks perlu dikonfigurasi.
- `test:cameras` perlu dikonfigurasi pada database test terpisah agar test tidak mengganggu produksi. `check:ready` dapat gagal hanya karena CCTV offline, sehingga skrip deployment memakai health API lokal, bukan tes kamera langsung. Hal ini **tidak menjamin** algoritma AI dan RTSP berhasil.
- Mekanisme penghentian inspeksi aktif, startup API dan AI, serta restart Nginx jika diperlukan harus disesuaikan dengan skrip nyata server. **Jangan menganggap contoh hook sudah siap.**
- Workflow hanya membangun installer desktop; pembaruan otomatis program Electron yang telah terpasang pada komputer pengguna memerlukan mekanisme updater/install tambahan.
- Versi skema DB tidak dikembalikan oleh rollback kode; sebab itu migrasi ditolak sampai ada prosedur deployment terpisah.
- Jika proses update `node_modules` atau network gagal saat aplikasi berhenti, rollback akan mencoba install/build ulang kode sebelumnya; ini tetap dapat gagal saat disk/jaringan rusak. Siapkan backup offline dan akses console.
- Jika repo dapat menerima kontribusi publik, self-hosted runner berisiko tinggi; batasi kontributor dan lindungi branch `production`. Jangan jalankan workflow dari PR yang tidak tepercaya pada runner produksi.
- Status DNS publik `pgtrangkil.aisugarcanembs.com` dan semua CCTV perlu diperiksa kembali sebelum mengklaim aplikasi produksi siap.

## Langkah kontrol cepat

```powershell
# Dari proyek server: status runner, layanan, port, hook, dan pg_dump
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\cicd\check-server.ps1

# Uji kesehatan lokal
Invoke-RestMethod http://127.0.0.1:8080/health -TimeoutSec 5

# Baca daftar file tanpa kredensial dan tanpa mengubah apa pun
git status --short
git branch --show-current
```

## Lokasi yang harus diperiksa sebelum deployment asli

- `scripts/start-public.ps1`, `scripts/resume-public.ps1` (perilaku restart belum tersedia di transkrip).
- `scripts/build-public.ps1` (apakah build root `npm run build` sudah mencakup kebutuhan Nginx/UI).
- `apps/api/src/migrate.ts`, `apps/ai-service/db/migrations.py` (perubahan schema mesti melalui prosedur terpisah).
- `package.json`, `apps/desktop/package.json` (nama script dan output instalasi).
- Status database PostgreSQL dan koneksi kamera dari server.
