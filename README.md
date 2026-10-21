# Math Adventure — Misi Pulau 1000

Game ujian **PTS Matematika Kelas 3 SD, Bab 1: Bilangan Cacah sampai 1.000** untuk HP Android. Guru membuat ruang ujian, siswa bergabung dengan kode ruang, nilai dihitung di server, lalu guru mengunduh laporan Excel/Google Sheets dan mencetak lembar hasil untuk orang tua.

**Alamat game (setelah GitHub Pages aktif):** https://misterizii.github.io/STS-MATEMATIKA-KELAS-3/

## Cara kerja

```
HP siswa / guru ──► GitHub Pages (web/)  ──fetch──►  Google Apps Script (gas/Code.gs)  ──►  Google Sheets
                    tampilan saja                     penilaian, kunci jawaban, laporan      database privat guru
```

GitHub Pages hanya dapat menyajikan file statis (HTML/JS), jadi bagian server tetap memakai Google Apps Script:

- **`web/`**: tampilan game dan dashboard guru, di-hosting gratis di GitHub Pages.
- **`gas/`**: API server dan database Google Sheets. Kunci jawaban, kata sandi guru, dan nilai tetap tersimpan di akun Google guru dan **tidak pernah ada di GitHub Pages**.

## Isi repositori

| Path | Isi |
|---|---|
| `web/index.html` | Antarmuka siswa dan guru (responsif untuk Android). |
| `web/config.js` | **Satu-satunya pengaturan**: alamat Web App Apps Script (`API_URL`). |
| `gas/Code.gs` | API server: login guru, ruang ujian, sesi peserta, penilaian, laporan. |
| `gas/appsscript.json` | Manifest proyek Apps Script. |
| `gas/Questions.gs` | Bank soal + kunci jawaban. **Sengaja tidak diunggah** (lihat peringatan di bawah). |
| `tests/test-logika.js` | Uji logika dengan tiruan layanan Apps Script (Node.js). |
| `.github/workflows/deploy-pages.yml` | Memublikasikan folder `web/` ke GitHub Pages secara otomatis. |

> ⚠️ **Repositori ini publik**, jadi siapa pun dapat membaca semua file di dalamnya. Karena itu `gas/Questions.gs` (teks soal dan kunci jawaban) dicantumkan di `.gitignore` dan **tidak diunggah**. Salin isinya dari arsip ZIP pribadi Anda langsung ke editor Apps Script. Hal yang sama berlaku untuk laporan `.xlsx` dan lembar cetak `.pdf`, karena keduanya memuat teks soal dan data siswa. Jangan menambahkan file-file tersebut ke repositori publik.

## Pemasangan

### Langkah 1: Pasang server di Google Apps Script

1. Masuk ke https://script.google.com/ dengan **akun Google guru**. Klik **New project** dan beri nama `Math Adventure PTS`.
2. Ganti isi `Code.gs` dengan isi file [`gas/Code.gs`](gas/Code.gs).
3. Tambahkan file **Script** bernama `Questions`, lalu tempel isi `Questions.gs` dari arsip ZIP pribadi Anda.
4. (Opsional) Buka **Project Settings**, centang *Show "appsscript.json" manifest file in editor*, lalu ganti isinya dengan [`gas/appsscript.json`](gas/appsscript.json).
5. Di **Project Settings → Script Properties → Add script property**, isi:
   - Property: `SETUP_ADMIN_PASSWORD`
   - Value: kata sandi guru buatan sendiri, **minimal 12 karakter**.
6. Kembali ke editor, pilih fungsi **`setupApplication`**, lalu klik **Run** dan izinkan akses Google Sheets. Database spreadsheet dibuat otomatis, kata sandi disimpan sebagai hash, dan `SETUP_ADMIN_PASSWORD` dihapus.
7. Klik **Deploy → New deployment**, pilih jenis **Web app**, lalu atur:
   - *Execute as / Jalankan sebagai*: **Me / Saya**
   - *Who has access / Siapa yang memiliki akses*: **Anyone / Siapa saja** (bukan "Anyone with Google account")

   Klik **Deploy**, lalu salin **Web app URL** yang berakhiran **`/exec`** (bukan `/dev`).
8. Uji dengan membuka URL `/exec` tersebut di browser. Halaman harus menampilkan teks seperti `{"ok":true,"result":{"app":"Math Adventure API","configured":true,...}}`. Jika `configured` bernilai `false`, ulangi langkah 5–6.

> File HTML **tidak** perlu dibuat di Apps Script karena tampilan sekarang di-hosting di GitHub Pages.

### Langkah 2: Hubungkan tampilan ke server

1. Di GitHub, buka [`web/config.js`](web/config.js) lalu klik ikon pensil (*Edit*).
2. Isi `API_URL` dengan URL `/exec` dari langkah 1:
   ```js
   window.APP_CONFIG = {
     API_URL: 'https://script.google.com/macros/s/AKfycb.../exec'
   };
   ```
3. Klik **Commit changes** ke branch `main`.

URL ini memang boleh terlihat publik. Fungsi guru tetap dilindungi kata sandi, dan kunci jawaban tidak pernah dikirim ke browser.

### Langkah 3: Aktifkan GitHub Pages

1. Buka **Settings → Pages**. Pada *Build and deployment → Source*, pilih **GitHub Actions**.
2. Setiap ada perubahan di branch `main`, workflow **Deploy ke GitHub Pages** (tab **Actions**) memublikasikan folder `web/`. Tunggu sampai bertanda ✅ (sekitar 1 menit).
3. Buka https://misterizii.github.io/STS-MATEMATIKA-KELAS-3/. Halaman depan menampilkan **Saya Murid** dan **Saya Guru**. Jika muncul kotak kuning *"Server ujian belum terhubung"*, periksa kembali langkah 2.

Jika workflow sempat gagal karena Pages belum diaktifkan, buka tab **Actions → Deploy ke GitHub Pages → Run workflow** setelah menyelesaikan langkah 3.1.

### Langkah 4: Pakai di kelas

1. Buka alamat GitHub Pages di Chrome Android, pilih **Saya Guru**, lalu masukkan kata sandi dari langkah 1.
2. Klik **Buat Ruang Baru**. Bagikan **alamat GitHub Pages + kode ruang** ke siswa. Setiap siswa mengetik **nomor peserta unik** dan namanya.
3. Klik **Mulai Ujian Serentak** setelah siswa gelombang pertama terlihat di dashboard. **Setiap siswa mendapat 40 menit sendiri**: siswa di lobi mulai dihitung saat guru menekan Mulai, sedangkan siswa yang bergabung belakangan dihitung sejak ia masuk. Sisa waktu tiap siswa tampil di tabel pemantauan.
   - **HP dipakai bergantian?** Siswa lain tetap bisa bergabung kapan saja selama ujian belum ditutup. Setelah siswa mengumpulkan, ia otomatis keluar. Layar hasil kembali ke halaman masuk dalam 60 detik (atau tekan **Selesai, ganti siswa berikutnya**), lalu siswa berikutnya masuk dengan nomor pesertanya sendiri.
4. Setelah **semua** siswa selesai, klik **Tutup Ujian Sekarang**. Ruang tidak tertutup sendiri, dan siswa yang masih mengerjakan saat ditutup langsung dinilai dari jawaban yang tersimpan. Lalu klik **Buat Laporan Excel & Sheets**. Buka spreadsheet laporan atau unduh `.xlsx` dengan akun Google guru (pemilik skrip).
5. Untuk lembar orang tua, setelah status ruang **Ditutup** klik **🖨️ Cetak Lembar Orang Tua**. Pilih satu siswa atau **Seluruh siswa**, lalu klik **Cetak / Simpan PDF** (kertas A4, skala 100%/Default). Perkiraan **4 halaman A4 per siswa**.
6. **Jangan membagikan dashboard guru atau database ke orang tua.** Bagikan hanya lembar/PDF milik anak yang bersangkutan.

## Memperbarui aplikasi

- **Tampilan (`web/`)**: commit ke `main`, maka situs terbit ulang otomatis. Minta siswa memuat ulang halaman.
- **Server (`gas/Code.gs`) atau soal (`Questions.gs`)**: tempel ke editor Apps Script, lalu klik **Deploy → Manage deployments → Edit (ikon pensil) → Version: New version → Deploy**. URL `/exec` tetap sama sehingga `config.js` tidak perlu diubah. Jangan memakai *New deployment* karena akan menghasilkan URL baru.
- Jangan memperbarui apa pun saat ujian sedang berlangsung. **Jangan mengubah ID soal Q01–Q20, kode indikator, atau kunci jawaban** jika sudah ada siswa yang mengerjakan.

### Pindah dari versi lama (yang dibuka lewat tautan `/exec`)

1. Tutup atau selesaikan semua ujian yang sedang berjalan. Cadangkan database Google Sheets (File → Make a copy).
2. Di proyek Apps Script yang **sama**, ganti isi `Code.gs` dengan versi baru. `Questions.gs` tetap. File HTML `Index` boleh dihapus.
3. Klik **Manage deployments → Edit → New version → Deploy**, dan pastikan *Who has access* = **Anyone**.
4. Lanjutkan ke langkah 2–3 di atas. Database, kata sandi guru, dan ruang lama tetap dipakai. **Jangan hapus** Script Properties `APP_DB_ID`, `ADMIN_SALT`, atau `ADMIN_HASH`.
5. Mulai sekarang bagikan alamat GitHub Pages ke siswa. Tautan `/exec` lama hanya menampilkan status server (JSON), bukan game. Sesi siswa yang tersimpan di HP dari tautan lama tidak ikut pindah.

## Fitur

- Guru membuat ruang berkode acak 7 karakter. Siswa bergabung lewat browser Android tanpa akun Google.
- Lima pulau berisi total 20 soal Bab 1: I1 membaca/menulis (3), I2 nilai tempat (3), I3 membandingkan/mengurutkan (4), I4 penjumlahan/pengurangan (6), I5 perkalian/pembagian (4).
- Tipe soal: pilihan ganda, simbol, susun kartu, urut bilangan, dan isian angka. Soal diacak **di dalam setiap pulau** sehingga analisis butir tetap sebanding. Pilihan jawaban juga diacak.
- Waktu 40 menit **per siswa** dihitung di server, sehingga siswa bisa masuk bergantian memakai HP yang sama. Jika waktu siswa habis atau guru menutup ujian, jawaban yang sudah tersimpan langsung dinilai.
- Setelah selesai, siswa otomatis keluar dari HP tersebut sehingga siswa berikutnya tidak melihat hasil temannya.
- Nilai 0–100, 5 poin per jawaban benar, nilai minimum tuntas **75**.
- Dashboard guru diperbarui sekitar setiap 8 detik. Jawaban tersimpan saat siswa menekan **Simpan & lanjut**.
- Jika koneksi siswa terputus, sesi tetap tersimpan di HP dan halaman tersambung kembali secara otomatis.
- Laporan Google Spreadsheet dengan enam tab (Ringkasan, Per Siswa, Per Indikator, Analisis Butir, Tindak Lanjut, Respons Soal) dan tautan unduh Excel.
- **Lembar soal terisi untuk orang tua** (sekitar 4 halaman A4 per siswa): 20 soal dalam urutan baku Q01–Q20, pilihan A–D dengan tanda **X** pada jawaban anak, isian/susunan kartu anak, kunci jawaban dan status per butir, analisis 5 indikator, saran tindak lanjut, serta kolom tanda tangan.

## Simulasi sebelum PTS sungguhan

- Uji coba dengan guru dan minimal **2 HP siswa**: bergabung bersamaan, menunggu di lobi, mulai, simpan tiga jenis soal, muat ulang halaman, dan pastikan jawaban masih tersimpan.
- Coba satu siswa mengumpulkan dan satu belum. Periksa nilai, KKM, laporan Excel, serta analisisnya.
- Setelah ruang ditutup, buka lembar cetak. Pastikan urutan soal Q01–Q20 sama untuk semua siswa, tanda **X** berada di samping pilihan asli siswa, dan jawaban kosong, kunci, indikator, nilai, serta tanda tangan tampil benar.
- Uji cetak di browser Android guru dan printer sekolah.
- Uji jaringan lambat dan pergantian tab. Jawaban yang **belum** disimpan dengan *Simpan & lanjut* tidak ikut dinilai.
- Naikkan jumlah peserta uji secara bertahap (10, 20, lalu seluruh kelas). **Apps Script memiliki kuota dan batas eksekusi serentak**, jadi 30–40 HP sekaligus harus diuji dulu di jaringan sekolah.

## Penilaian dan akurasi

Setiap peserta mendapat **20 soal yang sama** dengan urutan acak di dalam kelompok indikator. Bobot setiap soal 5, jadi **15 benar = nilai 75 (tuntas)**. Tidak ada poin tambahan untuk kecepatan, dan kunci jawaban hanya ada di `Questions.gs` di server. Hasil ditampilkan setelah siswa mengumpulkan atau ketika waktunya habis.

Rekomendasi remedial dibuat dari indikator dengan capaian **di bawah 75%**. Gunakan sebagai bahan diagnosis awal, bukan pengganti penilaian guru.

## Keamanan dan keterbatasan

- Siapa pun yang mengetahui alamat dapat membuka aplikasi. Fungsi guru dilindungi kata sandi di server, sedangkan identitas siswa hanya berupa kode ruang + nomor peserta + nama, dan siapa pun yang mengetahui ketiganya bisa melanjutkan sesi siswa itu. Guru tetap perlu mengawasi agar siswa tidak memakai identitas teman.
- Server hanya menerima pemanggilan fungsi yang terdaftar (`API_FUNCTIONS` di `Code.gs`). `setupApplication` dan fungsi pembantu tidak dapat dipanggil dari browser.
- Token sesi siswa disimpan di `localStorage` browser untuk domain `misterizii.github.io`. Jangan gunakan HP publik tanpa pengawasan. Menghapus data browser akan menghilangkan token sehingga siswa tidak bisa masuk lagi dengan nomor yang sama, jadi siapkan prosedur ganti perangkat sebelum ujian.
- Kata sandi admin disimpan sebagai **hash SHA-256 bersalt** di Script Properties. Sesi guru berlaku sampai 6 jam.
- Database dan laporan dimiliki akun Google guru. **Jangan bagikan database atau laporan dengan izin publik.** Lembar cetak memuat kunci jawaban, jadi bagikan hanya setelah ujian selesai.
- **Repositori GitHub ini publik.** Jangan unggah `Questions.gs`, laporan, atau data siswa ke dalamnya.
- Halaman diberi tanda `noindex` agar tidak muncul di mesin pencari, tetapi ini tidak menjamin kerahasiaan.
- Pembaruan memakai *polling* sekitar 8 detik, bukan WebSocket, sehingga bisa terlambat saat internet atau kuota Apps Script sedang sibuk.

## Pemecahan masalah

| Masalah | Solusi |
|---|---|
| Kotak kuning *"Server ujian belum terhubung"* | `API_URL` di `web/config.js` kosong atau tidak berakhiran `/exec`. Perbaiki, tunggu workflow selesai, lalu muat ulang halaman. |
| *"Tidak dapat terhubung ke server ujian"* | Periksa internet. Buka URL `/exec` di browser: jika diminta login Google, ubah *Who has access* menjadi **Anyone** lalu deploy *New version*. Akun Google Workspace sekolah bisa saja dibatasi admin sehingga opsi ini tidak tersedia. |
| *"Respons server tidak valid"* | Deployment salah, terhapus, atau memakai URL `/dev`. Salin URL `/exec` dari *Manage deployments*. |
| *"Fungsi server tidak dikenal"* | `Code.gs` di Apps Script masih versi lama. Tempel versi terbaru lalu deploy *New version*. |
| `SETUP_ADMIN_PASSWORD` belum ada | Tambahkan properti (minimal 12 karakter) lalu jalankan `setupApplication` lagi. |
| Halaman GitHub Pages 404 | Pastikan **Settings → Pages → Source = GitHub Actions** dan workflow di tab **Actions** berhasil. Tunggu 1–2 menit. |
| Perubahan tidak muncul | Untuk `web/`: tunggu workflow selesai lalu muat ulang (cache GitHub Pages bisa bertahan sampai ±10 menit). Untuk `gas/`: deploy *New version* di Apps Script. |
| Siswa melihat *"Koneksi ke server terputus"* | Sesi tetap aman. Halaman mencoba tersambung lagi sekitar setiap 8 detik, atau siswa bisa menekan **Coba lagi**. |
| Guru tiba-tiba keluar | Sesi guru habis. Masuk lagi dengan kata sandi. |
| Tombol lembar orang tua tidak muncul | Tombol muncul setelah guru menekan **Tutup Ujian Sekarang**. |
| Siswa keluar, ganti HP, atau mendapat pesan nomor sudah dipakai | Masuk lagi dengan kode ruang, **nomor peserta, dan nama yang sama persis** seperti saat pertama masuk. Jawaban tersimpan dan sisa waktu tetap; sesi di HP lama otomatis tidak berlaku. Nama siswa yang tercatat bisa dilihat di tabel dashboard guru. |
| Cetakan lebih dari 4 halaman per siswa | Gunakan A4 Portrait, skala 90–100%, margin Default/Minimum, dan matikan header/footer browser. |
| Ekspor Excel tidak berhasil | Buka spreadsheet laporan dengan akun pemilik, lalu **File → Download → Microsoft Excel (.xlsx)**. |
| Peserta tidak bisa bergabung | Kode salah, nomor peserta sudah dipakai, ruang sudah ditutup, atau ruang sudah berisi 40 peserta. |
| Jawaban gagal disimpan | Periksa internet lalu tekan Simpan lagi. Jika server sibuk, tunggu beberapa detik. |

## Uji logika lokal

```bash
node tests/test-logika.js
```

Membutuhkan Node.js 18 atau lebih baru serta file `gas/Questions.gs` (salin dari arsip pribadi; file ini diabaikan Git). Uji ini menjalankan `Code.gs` dengan tiruan layanan Apps Script dan memanggil setiap fungsi lewat `doPost`, sama seperti browser.

## Rujukan resmi

- Web app Apps Script: https://developers.google.com/apps-script/guides/web
- ContentService (respons JSON): https://developers.google.com/apps-script/guides/content
- Kuota Apps Script: https://developers.google.com/apps-script/guides/services/quotas
- GitHub Pages dengan GitHub Actions: https://docs.github.com/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
