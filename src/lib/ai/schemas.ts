import { z } from "zod";

export const aiDetectCompletionSchema = z.object({
  regions: z
    .array(
      z.object({
        sourceRegionId: z.string().min(1),
        label: z.string().min(1).max(80),
        description: z.string().min(1).max(200),
        confidence: z.number().min(0).max(1),
        score: z.number().min(0).max(100),
        rationale: z.string().min(1).max(400),
        include: z.boolean().default(true),
      }),
    )
    .max(12),
  warnings: z.array(z.string().min(1).max(200)).optional(),
});

export const aiConvertCompletionSchema = z.object({
  markdown: z.string().min(1),
  title: z.string().min(1).max(200).optional(),
  warnings: z.array(z.string().min(1).max(200)).optional(),
});

export type AiDetectCompletion = z.infer<typeof aiDetectCompletionSchema>;
export type AiConvertCompletion = z.infer<typeof aiConvertCompletionSchema>;
