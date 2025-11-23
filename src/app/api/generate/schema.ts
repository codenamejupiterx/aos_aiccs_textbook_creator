import { z } from "zod";

export const MAX_ITEMS = 20;
export const MAX_LEN = 40;

export const BodySchema = z.object({
  email: z.string().email().optional(),
  subject: z.string().min(1).max(120),
  passion: z.string().min(1).max(120),
  ageRange: z.enum([
    "Grades 3–5",
    "Grades 6–8",
    "Grades 9–12",
    "College / Adult",
  ]),
  notes: z.string().max(2000).optional().default(""),
  passionLikes: z
    .array(z.string().min(1).max(MAX_LEN))
    .max(MAX_ITEMS)
    .optional()
    .default([]),
});

export type Body = z.infer<typeof BodySchema>;
