// Grading classes are validated against the active Malang model configuration.
export type Grade = string;

export type ClassPercentages = {
  daun?: number;
  pucuk?: number;
  sampah?: number;
  [key: string]: number | undefined;
};
