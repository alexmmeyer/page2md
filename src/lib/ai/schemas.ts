import { z } from "zod";

export const aiRegionReasoningSchema = z.object({
  purpose: z.string().min(1).max(400),
  importance: z.string().min(1).max(400),
  nonOverlap: z.string().min(1).max(400),
  atomicity: z.string().min(1).max(400),
});

export const aiDetectCompletionSchema = z.object({
  regions: z
    .array(
      z.object({
        /**
         * Identifier of the candidate the AI is referring to. For the vision
         * flow this is the candidate `ref` (e.g. `c12`); for the legacy
         * heuristic flow this is the heuristic region id. The pipeline
         * normalizes common alias field names (ref / regionRef / id) into
         * `sourceRegionId` before parsing.
         */
        sourceRegionId: z.string().min(1),
        label: z.string().min(1).max(80),
        description: z.string().min(1).max(200),
        confidence: z.number().min(0).max(1),
        score: z.number().min(0).max(100),
        rationale: z.string().max(600).default(""),
        include: z.boolean().default(true),
        reasoning: aiRegionReasoningSchema.optional(),
      }),
    )
    .max(20),
  warnings: z.array(z.string().min(1).max(200)).optional(),
});

/**
 * Cleanup runs after deterministic htmlToMarkdown. The model returns a
 * pruned/normalized version of the input markdown — it may only remove or
 * normalize content, never add or re-word.
 */
export const aiCleanupCompletionSchema = z.object({
  markdown: z.string().min(1),
  removed: z.array(z.string().max(200)).optional(),
  warnings: z.array(z.string().min(1).max(200)).optional(),
});

export type AiDetectCompletion = z.infer<typeof aiDetectCompletionSchema>;
export type AiCleanupCompletion = z.infer<typeof aiCleanupCompletionSchema>;
