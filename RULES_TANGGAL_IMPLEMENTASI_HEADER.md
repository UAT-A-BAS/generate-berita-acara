# Rules Tanggal Implementasi pada Header Berita Acara

Dokumen ini adalah spesifikasi perilaku yang harus dipahami dan dipertahankan oleh AI atau developer ketika membuat, memperbaiki, atau memindahkan fitur tanggal implementasi.

Kata **WAJIB** berarti perilaku tidak boleh diubah tanpa persetujuan eksplisit. Kata **DILARANG** berarti hasil tersebut dianggap salah.

## 1. Tujuan dan hasil akhir

Tanggal implementasi ditampilkan pada baris kedua header Berita Acara dengan pola:

```text
{CABANG}, {DAFTAR TANGGAL IMPLEMENTASI}
```

Contoh:

```text
KCP BANDUNG, 10-12 AGUSTUS 2026
```

Rules header:

1. Nama cabang dan tanggal implementasi WAJIB menggunakan huruf kapital.
2. Cabang dan tanggal WAJIB dipisahkan dengan `, `.
3. Elemen yang kosong tidak boleh menghasilkan koma tambahan.
4. Nama hari DILARANG ditampilkan pada header.
5. Preview dan PDF WAJIB menggunakan hasil formatter yang sama.

## 2. Sumber data

Urutan prioritas sumber tanggal:

1. Gunakan `implementationDates` apabila array tersebut berisi tanggal.
2. Untuk data lama, gunakan `implementationStartDate` dan `implementationEndDate`.
3. Jika tanggal akhir tidak tersedia, gunakan `implementationDate` sebagai tanggal awal sekaligus akhir.
4. Rentang data lama WAJIB dikembangkan menjadi seluruh tanggal secara inklusif.
5. Tanggal aktivitas pada tabel DILARANG dijadikan sumber tanggal header.

Contoh fallback data lama:

```text
implementationStartDate = 10/08/2026
implementationEndDate   = 12/08/2026

Hasil internal = [10/08/2026, 11/08/2026, 12/08/2026]
```

## 3. Normalisasi tanggal

Sebelum diformat, sistem WAJIB:

1. Menerima tanggal valid dalam format `DD/MM/YYYY` atau format internal `YYYY-MM-DD`.
2. Memastikan tanggal benar-benar ada di kalender; contoh `31/02/2026` tidak valid.
3. Mengubah nilai valid menjadi format internal seragam `DD/MM/YYYY`.
4. Menghapus tanggal duplikat.
5. Mengurutkan tanggal secara kronologis dari paling awal ke paling akhir.

Pseudocode normatif:

```text
dates = parse(sourceDates)
dates = removeInvalidDates(dates)
dates = normalizeToDDMMYYYY(dates)
dates = removeDuplicates(dates)
dates = sortAscending(dates)
```

## 4. Rules pemilihan tanggal

Field tanggal implementasi adalah multi-select individual:

1. Klik satu tanggal untuk menambahkannya ke pilihan.
2. Klik ulang tanggal terpilih untuk menghapusnya.
3. Tombol `Today` menambahkan tanggal hari ini tanpa menghapus pilihan lain.
4. Tombol `Clear` menghapus semua tanggal implementasi.
5. Tombol `Done` hanya menutup date picker dan tidak menambah tanggal baru.

Ketentuan penting:

- Memilih tanggal awal dan tanggal akhir DILARANG otomatis memilih tanggal di tengah.
- Tanggal hanya dianggap berurutan jika setiap tanggal kalender di antara awal dan akhir benar-benar ada dalam pilihan.
- Urutan klik pengguna tidak menentukan urutan output; hasil selalu diurutkan secara kronologis.

## 5. Pengelompokan dan pemadatan

Sistem WAJIB mengelompokkan tanggal berdasarkan kombinasi bulan dan tahun terlebih dahulu. Setelah itu, hari-hari berurutan dalam kelompok yang sama dipadatkan menjadi rentang.

| Tanggal terpilih | Hasil tanggal header |
|---|---|
| `10/08/2026` | `10 AGUSTUS 2026` |
| `10/08`, `11/08`, `12/08` | `10-12 AGUSTUS 2026` |
| `10/08`, `12/08` | `10 DAN 12 AGUSTUS 2026` |
| `10/08`, `12/08`, `14/08` | `10, 12, DAN 14 AGUSTUS 2026` |
| `10/08`, `11/08`, `12/08`, `14/08` | `10-12 DAN 14 AGUSTUS 2026` |
| `11/08`, `12/08`, `22/08` | `11-12 DAN 22 AGUSTUS 2026` |
| `11/08`, `12/08`, `22/08`, `23/08`, `25/08`, `27/08` | `11-12, 22-23, 25, DAN 27 AGUSTUS 2026` |

Catatan normatif:

- Rentang memakai tanda hubung tanpa spasi, contoh `10-12`.
- Jika satu bulan memiliki dua bagian, bagian terakhir WAJIB didahului kata `dan`, termasuk ketika salah satu bagian berbentuk rentang.
- Jika satu bulan memiliki tiga bagian atau lebih, pisahkan bagian awal dengan koma dan tambahkan `dan` sebelum bagian terakhir.
- Gap DILARANG disembunyikan. Pilihan `10`, `11`, dan `13` harus menjadi `10-11 dan 13`, bukan `10-13`.

## 6. Rules lintas bulan dan tahun

Tanggal berurutan yang melewati batas bulan tetap dipisahkan per bulan karena pengelompokan bulan dilakukan sebelum pemadatan.

| Tanggal terpilih | Hasil tanggal header |
|---|---|
| `31/08/2026`, `01/09/2026` | `31 AGUSTUS DAN 1 SEPTEMBER 2026` |
| `30/08/2026`, `31/08/2026`, `01/09/2026` | `30-31 AGUSTUS DAN 1 SEPTEMBER 2026` |
| `11/08`, `12/08`, `21/09`, `22/09`, `23/09` | `11-12 AGUSTUS DAN 21-23 SEPTEMBER 2026` |
| `11/08`, `12/08`, `11/09`, `30/10` | `11-12 AGUSTUS, 11 SEPTEMBER, DAN 30 OKTOBER 2026` |
| `31/12/2026`, `01/01/2027` | `31 DESEMBER 2026 DAN 1 JANUARI 2027` |

Rules tahun:

1. Jika beberapa kelompok bulan berada pada tahun yang sama, tahun hanya ditulis pada kelompok bulan terakhir dalam tahun tersebut.
2. Jika kelompok berikutnya berbeda tahun, tahun WAJIB ditulis pada kelompok sebelumnya.
3. Setiap perpindahan tahun WAJIB terlihat eksplisit pada output.

## 7. Rules kata `dan` dan tanda koma

Dalam satu kelompok bulan, setiap tanggal tunggal atau rentang dihitung sebagai satu bagian:

| Jumlah bagian | Format |
|---|---|
| 1 | `10 AGUSTUS 2026` |
| 2 | `10 DAN 12 AGUSTUS 2026` |
| 3 atau lebih | `10, 12, DAN 14 AGUSTUS 2026` |

Rule yang sama WAJIB diterapkan ketika bagian mengandung rentang:

```text
11-12 dan 22 Agustus 2026
11-12, 22-23, 25, dan 27 Agustus 2026
```

Untuk beberapa kelompok bulan:

1. Dua kelompok sederhana digabung dengan `dan`.
2. Jika total bagian tanggal berjumlah tiga atau lebih, gunakan koma sebelum `dan`.
3. Tiga kelompok bulan atau lebih menggunakan pola `A, B, dan C`.
4. Kapitalisasi dilakukan setelah seluruh teks tanggal selesai dibentuk.

## 8. Validasi

Pembuatan dokumen WAJIB dihentikan apabila:

1. Tidak ada tanggal implementasi yang dipilih.
2. Ada nilai tanggal yang tidak dapat diparsing.
3. Nilai bukan tanggal kalender yang valid.

Pesan minimum ketika kosong:

```text
Tanggal implementasi wajib diisi.
```

Preview boleh menampilkan header parsial saat form belum lengkap. PDF atau dokumen final tidak boleh dibuat sebelum validasi lolos.

## 9. Acceptance criteria

Implementasi dianggap benar jika seluruh kondisi berikut lolos:

| ID | Input | Ekspektasi |
|---|---|---|
| AC-01 | Pilih satu tanggal | Header menampilkan satu tanggal tanpa nama hari |
| AC-02 | Pilih tiga tanggal berurutan | Header memadatkan menjadi satu rentang |
| AC-03 | Pilih tanggal dengan gap | Gap tetap terlihat dan tidak dijadikan rentang palsu |
| AC-04 | Klik tanggal terpilih lagi | Tanggal tersebut hilang dari header |
| AC-05 | Pilih tanggal tidak berurutan | Output diurutkan kronologis, bukan berdasarkan urutan klik |
| AC-06 | Pilih tanggal lintas bulan | Setiap bulan ditampilkan sebagai kelompok terpisah |
| AC-07 | Pilih tanggal lintas tahun | Tahun lama dan tahun baru sama-sama terlihat |
| AC-08 | Kosongkan semua tanggal | Generate ditolak dengan pesan wajib diisi |
| AC-09 | Buka preview dan generate PDF | Teks header keduanya identik |

## 10. Larangan perubahan implisit

AI atau developer DILARANG melakukan hal berikut tanpa permintaan eksplisit:

1. Mengubah multi-select individual menjadi auto-range.
2. Mengubah daftar tanggal menjadi rentang minimum–maksimum yang menutupi gap.
3. Menambahkan nama hari ke header.
4. Mengambil tanggal header dari kelompok aktivitas.
5. Menghasilkan format berbeda antara preview dan PDF.
