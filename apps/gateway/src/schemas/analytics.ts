import { z } from 'zod';

/** ISO-8601 date-time or bare date string, validated then parsed to a Date. */
const DateQueryParam = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: 'Must be a valid ISO-8601 date/time.' });

export const AnalyticsSummaryQuerySchema = z.object({
  since: DateQueryParam.optional(),
  until: DateQueryParam.optional(),
});

export type AnalyticsSummaryQuery = z.infer<typeof AnalyticsSummaryQuerySchema>;
