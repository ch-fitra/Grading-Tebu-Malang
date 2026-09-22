# SQL Server Express dan SSMS

SQL Server Express adalah database engine gratis dari Microsoft. SSMS adalah aplikasi untuk membuka, melihat, dan mengelola database SQL Server.

Jadi alurnya:

```plaintext
Aplikasi Tebu AI
  -> connect ke SQL Server Express
  -> data masuk ke database TebuAI
  -> SSMS dipakai manusia untuk cek tabel/data
```

## Yang Perlu Diinstall

1. Install SQL Server Express.
2. Install SQL Server Management Studio.
3. Buka SSMS.
4. Connect ke server lokal, biasanya salah satu ini:

```plaintext
localhost\SQLEXPRESS
.\SQLEXPRESS
localhost
```

## Buat Database

Di SSMS:

1. Klik kanan `Databases`.
2. Pilih `New Database`.
3. Isi nama:

```plaintext
TebuAI
```

4. Klik OK.

## Buat Tabel Awal

Buka file:

```plaintext
database/migrations/001_initial.sql
```

Copy isi SQL-nya ke `New Query` di SSMS, pastikan database aktif adalah `TebuAI`, lalu klik Execute.

Migration juga membuat user awal:

```plaintext
username: admin
password: admin
role: admin
```

## Connection String

Untuk aplikasi, koneksi database nanti ditaruh di `.env`:

```plaintext
DATABASE_URL="sqlserver://localhost:1433;database=TebuAI;user=sa;password=YourStrongPassword123;trustServerCertificate=true"
```

Jika memakai Windows Authentication, konfigurasi production-nya perlu disesuaikan lagi karena Prisma/Node umumnya lebih sederhana memakai SQL Authentication.

## Status Saat Ini

Backend sekarang masih memakai in-memory store untuk development cepat. Artinya data hilang saat backend restart.

Tahap berikutnya adalah menghubungkan Prisma ke SQL Server Express supaya:

- kamera tersimpan permanen
- model tersimpan permanen
- history inference tersimpan permanen
- data bisa dicek di SSMS
