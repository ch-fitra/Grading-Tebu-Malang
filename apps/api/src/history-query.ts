import { z } from "zod";

const querySchema = z.object({
  start_at: z.string().datetime({ offset: true }).optional(),
  end_at: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).max(10000000).default(0)
}).refine(value => (!value.start_at && !value.end_at) || Boolean(value.start_at && value.end_at && Date.parse(value.start_at) < Date.parse(value.end_at)), "Rentang waktu tidak valid");
export type HistoryQuery = z.infer<typeof querySchema>;
export function parseHistoryQuery(value: unknown): HistoryQuery {
  const result = querySchema.safeParse(value);
  if (!result.success) throw Object.assign(new Error("Rentang tanggal atau paginasi tidak valid"), { statusCode: 400 });
  return result.data;
}
