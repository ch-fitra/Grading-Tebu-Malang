export type TrangkilGradeCode = "S" | "M" | "A" | "D" | "B" | "T" | "G" | "X";

export interface GradeVariationLine {
  label: string;
  value: string;
  status: "good" | "warn" | "danger";
}

export interface TrangkilGradeItem {
  code: TrangkilGradeCode;
  label: string;
  name: string;
  tol: string;
  rafaksi: string;
  status: string;
  statusCls: string;
  badgeCls: string;
  img: string;
  color: string;
  grad: string;
  kriteria: string;
  decision: string;
  tier: "bebas" | "rafaksi" | "tolak" | "manual";
  variasi: GradeVariationLine[];
}

export const TRANGKIL_GRADES: TrangkilGradeItem[] = [
  {
    code: "S",
    label: "MBS S",
    name: "Super (Non-Kotor)",
    tol: "< 1% – 2%",
    rafaksi: "0% (Bebas)",
    status: "Lolos Prima",
    statusCls: "s",
    badgeCls: "badge-s",
    img: "/grades/mbs-s.jpg",
    color: "#2563eb",
    grad: "linear-gradient(90deg, #1d4ed8, #00d2ff)",
    kriteria: "Tebu super bersih, bebas daun & pucuk. Lolos langsung giling tanpa potongan bobot.",
    decision: "✓ Lolos Giling (Mutu Prima)",
    tier: "bebas",
    variasi: [
      { label: "Daduk Kering", value: "< 0.5% (Bebas Daun)", status: "good" },
      { label: "Pucuk Hijau", value: "< 1.0% (Potong Rapi)", status: "good" },
      { label: "Sampah/Batu", value: "0.0% (Nol Toleransi)", status: "good" },
    ]
  },
  {
    code: "M",
    label: "MBS M",
    name: "Stempel Simbol M",
    tol: "2% – 5%",
    rafaksi: "0% (Bebas)",
    status: "Standar Ideal",
    statusCls: "m",
    badgeCls: "badge-m",
    img: "/grades/mbs-m.jpg",
    color: "#0284c7",
    grad: "linear-gradient(90deg, #0284c7, #38bdf8)",
    kriteria: "Standar ideal PG Trangkil (Simbol M). Bersih optimal dengan kotoran serpihan minimal.",
    decision: "✓ Lolos Giling (Standar Utama M)",
    tier: "bebas",
    variasi: [
      { label: "Daduk Kering", value: "1.0% – 2.0% (Serpihan Tipis)", status: "good" },
      { label: "Pucuk Hijau", value: "1.0% – 2.5% (Standar M)", status: "good" },
      { label: "Sampah/Tanah", value: "< 0.5% (Debu Meja Saja)", status: "good" },
    ]
  },
  {
    code: "A",
    label: "MBS A",
    name: "Stempel Simbol A",
    tol: "6% – 10%",
    rafaksi: "0% (Bebas)",
    status: "Toleransi Giling",
    statusCls: "a",
    badgeCls: "badge-a",
    img: "/grades/mbs-a.jpg",
    color: "#059669",
    grad: "linear-gradient(90deg, #059669, #34d399)",
    kriteria: "Batas toleransi layak giling (Simbol A). Terdapat daun ringan tanpa sanksi bobot.",
    decision: "✓ Lolos Toleransi Giling (Simbol A)",
    tier: "bebas",
    variasi: [
      { label: "Daduk Kering", value: "3.0% – 5.0% (Daun Ringan)", status: "good" },
      { label: "Pucuk Hijau", value: "2.0% – 4.0% (Toleransi Masuk)", status: "good" },
      { label: "Sampah/Tanah", value: "< 1.0% (Sedimen Halus)", status: "good" },
    ]
  },
  {
    code: "D",
    label: "MBS D",
    name: "Potongan Bobot 1%",
    tol: "11% – 15%",
    rafaksi: "-1,0% Bobot",
    status: "Pengawasan",
    statusCls: "d",
    badgeCls: "badge-d",
    img: "/grades/mbs-d.jpg",
    color: "#d97706",
    grad: "linear-gradient(90deg, #d97706, #fbbf24)",
    kriteria: "Kotoran sedang (daun tebal / pucuk panjang). Diterima dengan sanksi potongan bobot 1%.",
    decision: "⚠ Diterima Rafaksi Ringan (-1%)",
    tier: "rafaksi",
    variasi: [
      { label: "Daduk Kering", value: "5.0% – 8.0% (Daun Tebal)", status: "warn" },
      { label: "Pucuk Hijau", value: "4.0% – 6.0% (Pucuk Masih Ada)", status: "warn" },
      { label: "Sampah/Tanah", value: "1.0% – 2.0% (Ada Kerikil)", status: "warn" },
    ]
  },
  {
    code: "B",
    label: "MBS B",
    name: "Potongan Bobot 2,5%",
    tol: "16% – 20%",
    rafaksi: "-2,5% Bobot",
    status: "Sortir Meja",
    statusCls: "b",
    badgeCls: "badge-b",
    img: "/grades/mbs-b.jpg",
    color: "#ea580c",
    grad: "linear-gradient(90deg, #ea580c, #fb923c)",
    kriteria: "Kotoran tinggi (banyak daduk & tanah). Diterima dengan sanksi potongan bobot 2,5%.",
    decision: "⚠ Diterima Rafaksi Berat (-2.5%)",
    tier: "rafaksi",
    variasi: [
      { label: "Daduk Kering", value: "8.0% – 10.0% (Daun Lebat)", status: "warn" },
      { label: "Pucuk Hijau", value: "6.0% – 8.0% (Pucuk Utuh)", status: "warn" },
      { label: "Sampah/Tanah", value: "2.0% – 3.0% (Tanah Melekat)", status: "warn" },
    ]
  },
  {
    code: "T", label: "MBS T", name: "Menunggu keputusan QC manual",
    tol: "Ditinjau QC", rafaksi: "Ditentukan QC", status: "Perlu keputusan QC",
    statusCls: "t", badgeCls: "badge-t", img: "/grades/mbs-t.png",
    color: "#9333ea", grad: "linear-gradient(90deg, #9333ea, #c084fc)",
    kriteria: "Kelas T sesuai hasil model dan database. Keputusan giling dan rafaksi menunggu peninjauan QC secara manual.",
    decision: "Menunggu keputusan QC manual", tier: "manual",
    variasi: [{ label: "Kelas Model", value: "T", status: "warn" },
      { label: "Toleransi", value: "Ditinjau QC", status: "warn" },
      { label: "Rafaksi", value: "Ditentukan QC", status: "warn" }]
  },
  {
    code: "G",
    label: "MBS G",
    name: "Ditolak Giling",
    tol: "> 20%",
    rafaksi: "Reject Giling",
    status: "Ditolak Meja",
    statusCls: "g",
    badgeCls: "badge-g",
    img: "/grades/mbs-g.jpg",
    color: "#dc2626",
    grad: "linear-gradient(90deg, #dc2626, #f87171)",
    kriteria: "Kotoran melebihi batas penerimaan pabrik. Ditolak di meja tebu / wajib sortir ulang.",
    decision: "✕ Ditolak Giling (Reject Meja)",
    tier: "tolak",
    variasi: [
      { label: "Daduk Kering", value: "> 10.0% (Kotoran Masif)", status: "danger" },
      { label: "Pucuk Hijau", value: "> 8.0% (Belum Dipotong)", status: "danger" },
      { label: "Sampah/Tanah", value: "> 3.0% (Bongkahan Tanah)", status: "danger" },
    ]
  },
  {
    code: "X",
    label: "MBS X",
    name: "Afkir Mutlak",
    tol: "Masif / Bahaya",
    rafaksi: "Tolak Mutlak",
    status: "Afkir Total",
    statusCls: "x",
    badgeCls: "badge-x",
    img: "/grades/mbs-x.jpg",
    color: "#991b1b",
    grad: "linear-gradient(90deg, #7f1d1d, #ef4444)",
    kriteria: "Tercampur batu, kayu, tanah gumpal, atau tebu busuk. Ditolak mutlak karena bahaya gilingan.",
    decision: "✕ Ditolak Mutlak (Afkir / Tolak DO)",
    tier: "tolak",
    variasi: [
      { label: "Daduk Kering", value: "Campuran Masif / Busuk", status: "danger" },
      { label: "Pucuk Hijau", value: "Tebu Rusak / Mati Total", status: "danger" },
      { label: "Sampah Asing", value: "Batu/Kayu/Besi (Bahaya Roll)", status: "danger" },
    ]
  },
];

export function normalizeGrade(rawGrade?: string | null): TrangkilGradeCode {
  if (!rawGrade) return "M";
  const g = rawGrade.toUpperCase().trim().replace(/^MBS\s*/, "").trim();
  if (g === "S") return "S";
  if (g === "M") return "M";
  if (g === "A") return "A";
  if (g === "D") return "D";
  if (g === "B") return "B";
  if (g === "T") return "T";
  if (g === "G" || g === "REJECT" || g === "REJECT_G") return "G";
  if (g === "X" || g === "REJECT_X") return "X";
  if (g === "C") return "D";
  if (g === "A/M") return "A";
  return "M";
}
