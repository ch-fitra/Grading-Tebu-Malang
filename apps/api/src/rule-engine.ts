export type Grade = "S" | "M" | "A" | "D" | "B" | "G" | "X";

export type ClassPercentages = {
  daun?: number;
  pucuk?: number;
  sampah?: number;
  [key: string]: number | undefined;
};

export function calculateGrade(classes: ClassPercentages): Grade {
  const daun = classes.daun ?? 0;
  const pucuk = classes.pucuk ?? 0;
  const sampah = classes.sampah ?? 0;
  const totalKotoran = daun + pucuk + sampah;

  // Afkir / Bahaya ekstrim (sampah asing tinggi atau kotoran masif)
  if (sampah > 15 || totalKotoran > 35) return "X";
  // Ditolak Giling (Reject meja tebu)
  if (totalKotoran > 20) return "G";
  // Potongan Bobot 2,5% (Sortir meja)
  if (totalKotoran > 15) return "B";
  // Potongan Bobot 1% (Pengawasan)
  if (totalKotoran > 10) return "D";
  // Toleransi Giling (Simbol A)
  if (totalKotoran > 5) return "A";
  // Standar Ideal (Simbol M)
  if (totalKotoran > 2) return "M";
  // Super (Non-Kotor)
  return "S";
}
