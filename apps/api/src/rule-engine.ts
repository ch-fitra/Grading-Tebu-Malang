export type Grade = "M" | "A/M" | "A" | "D" | "B" | "Reject";

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
  const impurity = daun + sampah;

  if (pucuk > 30) return "B";
  if (impurity < 2) return "M";
  if (impurity < 5) return "A/M";
  if (impurity < 10) return "A";
  if (impurity < 20) return "D";
  return "Reject";
}
