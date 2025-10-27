import { z } from "zod";

export const WeekItemSchema = z.object({
  week: z.number().int().min(1).max(16),
  title: z.string().min(1),
  goals: z.array(z.string()).min(1),
  topics: z.array(z.string()).min(1),
  activity: z.string().min(1),
  assessment: z.string().min(1),
});

export const ReferenceSchema = z.object({
  type: z.enum(["web","book","article","report"]),
  title: z.string(),
  author: z.string(),
  year: z.string(),
  publisher: z.string().optional(),
  url: z.string().url().optional(),
});

export const Week1ChapterSchema = z.object({
  title: z.string(),
  abstract: z.string(),
  sections: z.array(z.object({ heading: z.string(), body: z.string() })).min(3),
  figures: z.array(z.object({ label: z.string(), caption: z.string(), suggested_visual: z.string() })).optional().default([]),
  citations_style: z.enum(["APA","MLA"]),
  intext_citations: z.boolean(),
  references: z.array(ReferenceSchema).optional().default([]),
  ai_generated: z.boolean(),
  estimated_word_count: z.number().int().min(400),
});

export const OutputSchema = z.object({
  curriculum16: z.array(WeekItemSchema).length(16),
  week1Chapter: Week1ChapterSchema,
});

export type Output = z.infer<typeof OutputSchema>;
