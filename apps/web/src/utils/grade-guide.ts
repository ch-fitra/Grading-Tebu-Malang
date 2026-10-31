export type KebonAgungGradeCode = "S" | "M" | "A" | "D" | "B" | "T" | "G" | "X";

export interface KebonAgungGradeItem {
  code: KebonAgungGradeCode;
  label: string;
  name: string;
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
}

export const KEBONAGUNG_GRADES: KebonAgungGradeItem[] = [
  {
    code: "S",
    label: "MBS S",
    name: "Super",
    rafaksi: "0% (Bebas)",
    status: "Lolos Prima",
    statusCls: "s",
    badgeCls: "badge-s",
    img: "/grades/mbs-s.jpg",
    color: "#2563eb",
    grad: "linear-gradient(90deg, #1d4ed8, #00d2ff)",
    kriteria: "Tebu super bersih, bebas daun & pucuk. Lolos langsung giling tanpa potongan bobot.",
    decision: "✓ Lolos Giling (Mutu Prima)",
    tier: "bebas"
  },
  {
    code: "M",
    label: "MBS M",
    name: "Stempel Simbol M",
    rafaksi: "0% (Bebas)",
    status: "Standar Ideal",
    statusCls: "m",
    badgeCls: "badge-m",
    img: "/grades/mbs-m.jpg",
    color: "#0284c7",
    grad: "linear-gradient(90deg, #0284c7, #38bdf8)",
    kriteria: "Referensi kelas M (validasi QC Malang diperlukan). Lolos giling tanpa potongan bobot.",
    decision: "✓ Lolos Giling (Standar Utama M)",
    tier: "bebas"
  },
  {
    code: "A",
    label: "MBS A",
    name: "Stempel Simbol A",
    rafaksi: "0% (Bebas)",
    status: "Toleransi Giling",
    statusCls: "a",
    badgeCls: "badge-a",
    img: "/grades/mbs-a.jpg",
    color: "#059669",
    grad: "linear-gradient(90deg, #059669, #34d399)",
    kriteria: "Batas toleransi layak giling (Simbol A). Terdapat daun ringan tanpa sanksi bobot.",
    decision: "✓ Lolos Toleransi Giling (Simbol A)",
    tier: "bebas"
  },
  {
    code: "D",
    label: "MBS D",
    name: "Potongan Bobot 1%",
    rafaksi: "-1,0% Bobot",
    status: "Pengawasan",
    statusCls: "d",
    badgeCls: "badge-d",
    img: "/grades/mbs-d.jpg",
    color: "#d97706",
    grad: "linear-gradient(90deg, #d97706, #fbbf24)",
    kriteria: "Kelas D. Diterima dengan kebijakan potongan bobot 1%.",
    decision: "⚠ Diterima Rafaksi Ringan (-1%)",
    tier: "rafaksi"
  },
  {
    code: "B",
    label: "MBS B",
    name: "Potongan Bobot 2,5%",
    rafaksi: "-2,5% Bobot",
    status: "Sortir Meja",
    statusCls: "b",
    badgeCls: "badge-b",
    img: "/grades/mbs-b.jpg",
    color: "#ea580c",
    grad: "linear-gradient(90deg, #ea580c, #fb923c)",
    kriteria: "Kelas B. Diterima dengan kebijakan potongan bobot 2,5%.",
    decision: "⚠ Diterima Rafaksi Berat (-2.5%)",
    tier: "rafaksi"
  },
  {
    code: "T", label: "MBS T", name: "Menunggu keputusan QC manual",
    rafaksi: "Ditentukan QC", status: "Perlu keputusan QC",
    statusCls: "t", badgeCls: "badge-t", img: "/grades/mbs-t.png",
    color: "#9333ea", grad: "linear-gradient(90deg, #9333ea, #c084fc)",
    kriteria: "Kelas T sesuai hasil model dan database. Keputusan giling dan rafaksi menunggu peninjauan QC secara manual.",
    decision: "Menunggu keputusan QC manual", tier: "manual"
  },
  {
    code: "G",
    label: "MBS G",
    name: "Ditolak Giling",
    rafaksi: "Reject Giling",
    status: "Ditolak Meja",
    statusCls: "g",
    badgeCls: "badge-g",
    img: "/grades/mbs-g.jpg",
    color: "#dc2626",
    grad: "linear-gradient(90deg, #dc2626, #f87171)",
    kriteria: "Kelas G. Ditolak di meja tebu dan memerlukan sortir ulang.",
    decision: "✕ Ditolak Giling (Reject Meja)",
    tier: "tolak"
  },
  {
    code: "X",
    label: "MBS X",
    name: "Afkir Mutlak",
    rafaksi: "Tolak Mutlak",
    status: "Afkir Total",
    statusCls: "x",
    badgeCls: "badge-x",
    img: "/grades/mbs-x.jpg",
    color: "#991b1b",
    grad: "linear-gradient(90deg, #7f1d1d, #ef4444)",
    kriteria: "Tercampur batu, kayu, tanah gumpal, atau tebu busuk. Ditolak mutlak karena bahaya gilingan.",
    decision: "✕ Ditolak Mutlak (Afkir / Tolak DO)",
    tier: "tolak"
  },
];

export function normalizeGrade(rawGrade?: string | null): KebonAgungGradeCode {
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
