// Stored historical grades and percentages; no grading engine is configured.
export type Grade = string;

export type ClassPercentages = {
  daun?: number;
  pucuk?: number;
  sampah?: number;
  [key: string]: number | undefined;
};
