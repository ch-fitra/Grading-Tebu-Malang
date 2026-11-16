import type { Grade } from "../types";
export type KebonAgungGradeCode = Grade;

export interface KebonAgungGradeItem {
  index?: number;
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
    "index": 0,
    "code": "ATPSD",
    "label": "ATPSD",
    "name": "Indeks model 0",
    "rafaksi": "Ditentukan QC",
    "status": "Kelas 0",
    "statusCls": "m",
    "badgeCls": "badge-m",
    "img": "/grades/malang-reference.svg",
    "color": "#64748b",
    "grad": "linear-gradient(90deg, #64748b, #64748b)",
    "kriteria": "Kelas ATPSD, sesuai indeks 0 pada model Malang. Keputusan operasional dan rafaksi mengikuti penilaian QC.",
    "decision": "Menunggu keputusan QC",
    "tier": "manual"
  },
  {
    "index": 1,
    "code": "Akar Tanah",
    "label": "Akar Tanah",
    "name": "Indeks model 1",
    "rafaksi": "Ditentukan QC",
    "status": "Kelas 1",
    "statusCls": "m",
    "badgeCls": "badge-m",
    "img": "/grades/malang-reference.svg",
    "color": "#92400e",
    "grad": "linear-gradient(90deg, #92400e, #92400e)",
    "kriteria": "Kelas Akar Tanah, sesuai indeks 1 pada model Malang. Keputusan operasional dan rafaksi mengikuti penilaian QC.",
    "decision": "Menunggu keputusan QC",
    "tier": "manual"
  },
  {
    "index": 2,
    "code": "Daduk",
    "label": "Daduk",
    "name": "Indeks model 2",
    "rafaksi": "Ditentukan QC",
    "status": "Kelas 2",
    "statusCls": "m",
    "badgeCls": "badge-m",
    "img": "/grades/malang-reference.svg",
    "color": "#ca8a04",
    "grad": "linear-gradient(90deg, #ca8a04, #ca8a04)",
    "kriteria": "Kelas Daduk, sesuai indeks 2 pada model Malang. Keputusan operasional dan rafaksi mengikuti penilaian QC.",
    "decision": "Menunggu keputusan QC",
    "tier": "manual"
  },
  {
    "index": 3,
    "code": "Kocok Air",
    "label": "Kocok Air",
    "name": "Indeks model 3",
    "rafaksi": "Ditentukan QC",
    "status": "Kelas 3",
    "statusCls": "m",
    "badgeCls": "badge-m",
    "img": "/grades/malang-reference.svg",
    "color": "#0891b2",
    "grad": "linear-gradient(90deg, #0891b2, #0891b2)",
    "kriteria": "Kelas Kocok Air, sesuai indeks 3 pada model Malang. Keputusan operasional dan rafaksi mengikuti penilaian QC.",
    "decision": "Menunggu keputusan QC",
    "tier": "manual"
  },
  {
    "index": 4,
    "code": "MBS",
    "label": "MBS",
    "name": "Indeks model 4",
    "rafaksi": "Ditentukan QC",
    "status": "Kelas 4",
    "statusCls": "m",
    "badgeCls": "badge-m",
    "img": "/grades/malang-reference.svg",
    "color": "#059669",
    "grad": "linear-gradient(90deg, #059669, #059669)",
    "kriteria": "Kelas MBS, sesuai indeks 4 pada model Malang. Keputusan operasional dan rafaksi mengikuti penilaian QC.",
    "decision": "Menunggu keputusan QC",
    "tier": "manual"
  },
  {
    "index": 5,
    "code": "MBS Bintang",
    "label": "MBS Bintang",
    "name": "Indeks model 5",
    "rafaksi": "Ditentukan QC",
    "status": "Kelas 5",
    "statusCls": "m",
    "badgeCls": "badge-m",
    "img": "/grades/malang-reference.svg",
    "color": "#2563eb",
    "grad": "linear-gradient(90deg, #2563eb, #2563eb)",
    "kriteria": "Kelas MBS Bintang, sesuai indeks 5 pada model Malang. Keputusan operasional dan rafaksi mengikuti penilaian QC.",
    "decision": "Menunggu keputusan QC",
    "tier": "manual"
  },
  {
    "index": 6,
    "code": "MBS Plus",
    "label": "MBS Plus",
    "name": "Indeks model 6",
    "rafaksi": "Ditentukan QC",
    "status": "Kelas 6",
    "statusCls": "m",
    "badgeCls": "badge-m",
    "img": "/grades/malang-reference.svg",
    "color": "#0d9488",
    "grad": "linear-gradient(90deg, #0d9488, #0d9488)",
    "kriteria": "Kelas MBS Plus, sesuai indeks 6 pada model Malang. Keputusan operasional dan rafaksi mengikuti penilaian QC.",
    "decision": "Menunggu keputusan QC",
    "tier": "manual"
  },
  {
    "index": 7,
    "code": "Non MBS",
    "label": "Non MBS",
    "name": "Indeks model 7",
    "rafaksi": "Ditentukan QC",
    "status": "Kelas 7",
    "statusCls": "m",
    "badgeCls": "badge-m",
    "img": "/grades/malang-reference.svg",
    "color": "#ea580c",
    "grad": "linear-gradient(90deg, #ea580c, #ea580c)",
    "kriteria": "Kelas Non MBS, sesuai indeks 7 pada model Malang. Keputusan operasional dan rafaksi mengikuti penilaian QC.",
    "decision": "Menunggu keputusan QC",
    "tier": "manual"
  },
  {
    "index": 8,
    "code": "Sogolan Pucuk",
    "label": "Sogolan Pucuk",
    "name": "Indeks model 8",
    "rafaksi": "Ditentukan QC",
    "status": "Kelas 8",
    "statusCls": "m",
    "badgeCls": "badge-m",
    "img": "/grades/malang-reference.svg",
    "color": "#65a30d",
    "grad": "linear-gradient(90deg, #65a30d, #65a30d)",
    "kriteria": "Kelas Sogolan Pucuk, sesuai indeks 8 pada model Malang. Keputusan operasional dan rafaksi mengikuti penilaian QC.",
    "decision": "Menunggu keputusan QC",
    "tier": "manual"
  },
  {
    "index": 9,
    "code": "Tebu Muda",
    "label": "Tebu Muda",
    "name": "Indeks model 9",
    "rafaksi": "Ditentukan QC",
    "status": "Kelas 9",
    "statusCls": "m",
    "badgeCls": "badge-m",
    "img": "/grades/malang-reference.svg",
    "color": "#9333ea",
    "grad": "linear-gradient(90deg, #9333ea, #9333ea)",
    "kriteria": "Kelas Tebu Muda, sesuai indeks 9 pada model Malang. Keputusan operasional dan rafaksi mengikuti penilaian QC.",
    "decision": "Menunggu keputusan QC",
    "tier": "manual"
  },
  {
    "index": 10,
    "code": "Terbakar",
    "label": "Terbakar",
    "name": "Indeks model 10",
    "rafaksi": "Ditentukan QC",
    "status": "Kelas 10",
    "statusCls": "m",
    "badgeCls": "badge-m",
    "img": "/grades/malang-reference.svg",
    "color": "#dc2626",
    "grad": "linear-gradient(90deg, #dc2626, #dc2626)",
    "kriteria": "Kelas Terbakar, sesuai indeks 10 pada model Malang. Keputusan operasional dan rafaksi mengikuti penilaian QC.",
    "decision": "Menunggu keputusan QC",
    "tier": "manual"
  }
];

export const UNRECOGNIZED_GRADE: KebonAgungGradeItem = {
  code: "Belum Dikenali", label: "Belum Dikenali", name: "Perlu pemeriksaan QC",
  rafaksi: "Ditentukan QC", status: "Belum yakin", statusCls: "m", badgeCls: "badge-m",
  img: "/grades/malang-reference.svg", color: "#64748b", grad: "#64748b",
  kriteria: "Skor model belum memenuhi ambang penerimaan. Tidak ada kelas mutu yang dipastikan.",
  decision: "Perlu pemeriksaan QC", tier: "manual"
};
export const GRADING_OUTCOMES = [...KEBONAGUNG_GRADES, UNRECOGNIZED_GRADE];

export function normalizeGrade(rawGrade?: string | null): KebonAgungGradeCode {
  const value = rawGrade?.trim() ?? "";
  return (KEBONAGUNG_GRADES.find(item => item.code.toLowerCase() === value.toLowerCase())?.code ?? value) as Grade;
}

export function gradeDefinition(rawGrade?: string | null): KebonAgungGradeItem {
  const code = normalizeGrade(rawGrade);
  return GRADING_OUTCOMES.find(item => item.code === code) ?? {
    code, label: code || "?", name: code ? "Kelas riwayat" : "Belum ada deteksi",
    rafaksi: "Ditentukan QC", status: "Referensi", statusCls: "m", badgeCls: "badge-m",
    img: "/grades/malang-reference.svg", color: "#64748b", grad: "#64748b",
    kriteria: "Data riwayat atau belum ada hasil model Malang.", decision: "Menunggu keputusan QC", tier: "manual"
  };
}
