import { NextResponse } from "next/server";
import { z } from "zod";

import { markdownWithYamlFrontmatter } from "@/lib/convert/markdown-frontmatter";
import { emitJsonOutput } from "@/lib/emit/json-emitter";
import { convertRegionWithAi, detectRegionsWithAi } from "@/lib/ai/pipeline";
import type { AiConversionResponse, ExtractionRegion } from "@/lib/types/conversion";

export const runtime = "nodejs";

const IS_DEV = process.env.NODE_ENV === "development";

const preDetectedRegionSchema: z.ZodType<ExtractionRegion> = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  previewText: z.string().optional(),
  kind: z.enum([
    "main",
    "article",
    "content",
    "navigation",
    "header",
    "footer",
    "sidebar",
    "toc",
    "section",
  ]),
  textLength: z.number().nonnegative(),
  linkDensity: z.number().nonnegative(),
  score: z.number(),
});

const aiRequestSchema = z.object({
  engine: z.literal("ai").default("ai"),
  stage: z.enum(["detect", "convert"]),
  sourceType: z.enum(["url", "html", "paste", "tab"]),
  source: z.string().min(1, "Source is required."),
  outputFormat: z.enum(["markdown", "json"]).default("markdown"),
  selectedRegionId: z.string().optional(),
  selectedRegionHtml: z.string().optional(),
  preDetectedRegions: z.array(preDetectedRegionSchema).max(20).optional(),
  titleHint: z.string().max(200).optional(),
});

export async function POST(request: Request) {
  try {
    const payload = aiRequestSchema.parse(await request.json());
    if (payload.sourceType === "url") {
      try {
        new URL(payload.source);
      } catch {
        return NextResponse.json({ error: "Invalid URL format." }, { status: 400 });
      }
    }

    if (IS_DEV) {
      const sourceLabel =
        payload.sourceType === "url"
          ? payload.source
          : payload.sourceType === "paste"
            ? `(pasted text, ${payload.source.length} chars)`
            : payload.sourceType === "html"
              ? `(pasted HTML, ${payload.source.length} chars)`
              : `(tab)`;
      if (payload.stage === "detect") {
        console.log(`\n[page2md] ▶ User triggered "Convert with AI"`);
        console.log(`[page2md]   stage=detect  sourceType=${payload.sourceType}  source=${sourceLabel}`);
        const visionFlow = payload.sourceType === "url" || payload.sourceType === "html";
        console.log(`[page2md]   detection flow: ${visionFlow ? "vision (screenshot + DOM walker)" : "legacy (heuristic candidates)"}`);
        if (payload.preDetectedRegions?.length) {
          console.log(`[page2md]   pre-detected regions from extension: ${payload.preDetectedRegions.length}`);
        }
      } else {
        console.log(`\n[page2md] ▶ User selected a region — converting to markdown`);
        console.log(`[page2md]   stage=convert  sourceType=${payload.sourceType}  source=${sourceLabel}`);
        console.log(`[page2md]   selectedRegionId=${payload.selectedRegionId ?? "(none)"}  htmlProvided=${Boolean(payload.selectedRegionHtml)}`);
      }
    }

    if (payload.stage === "detect") {
      const detected = await detectRegionsWithAi({
        sourceType: payload.sourceType,
        source: payload.source,
        outputFormat: payload.outputFormat,
        preDetectedRegions: payload.preDetectedRegions,
        titleHint: payload.titleHint,
      });
      if (IS_DEV) {
        console.log(`[page2md]   detect complete — ${detected.aiRegions.length} region(s) surfaced to user${detected.fallbackUsed ? "  ⚠ fallback used" : ""}`);
      }
      const response: AiConversionResponse = {
        engine: "ai",
        stage: "detect",
        outputFormat: payload.outputFormat,
        report: detected.report,
        meta: detected.meta,
        aiRegions: detected.aiRegions,
        regions: detected.regions,
        defaultRegionId: detected.defaultRegionId,
        selectedRegionId: detected.selectedRegionId,
        selectedRegionLabel: detected.selectedRegionLabel,
        selectedAiRegionId: detected.aiRegions[0]?.id,
        selectedAiRegionLabel: detected.aiRegions[0]?.label,
        model: detected.model,
        aiWarnings: detected.aiWarnings,
        fallbackUsed: detected.fallbackUsed,
      };
      return NextResponse.json(response);
    }

    const converted = await convertRegionWithAi({
      sourceType: payload.sourceType,
      source: payload.source,
      outputFormat: payload.outputFormat,
      selectedRegionId: payload.selectedRegionId,
      selectedRegionHtml: payload.selectedRegionHtml,
      preDetectedRegions: payload.preDetectedRegions,
      titleHint: payload.titleHint,
    });
    const markdown = markdownWithYamlFrontmatter(converted.markdownBody, converted.meta);
    if (IS_DEV) {
      console.log(`[page2md]   convert complete — ${converted.markdownBody.length} chars of markdown${converted.fallbackUsed ? "  ⚠ fallback used" : ""}`);
    }
    const response: AiConversionResponse = {
      engine: "ai",
      stage: "convert",
      outputFormat: payload.outputFormat,
      markdown: payload.outputFormat === "markdown" ? markdown : undefined,
      json:
        payload.outputFormat === "json"
          ? emitJsonOutput(markdown, converted.meta, converted.report)
          : undefined,
      report: converted.report,
      meta: converted.meta,
      selectedRegionId: converted.meta.selectedRegionId,
      selectedRegionLabel: converted.meta.selectedRegionLabel,
      selectedAiRegionId: converted.meta.selectedRegionId ? `ai-${converted.meta.selectedRegionId}` : undefined,
      selectedAiRegionLabel: converted.meta.selectedRegionLabel,
      model: converted.model,
      aiWarnings: converted.aiWarnings,
      fallbackUsed: converted.fallbackUsed,
    };
    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const message = error.issues.map((issue) => issue.message).join(", ");
      return NextResponse.json({ error: message }, { status: 400 });
    }
    const message =
      error instanceof Error
        ? error.message
        : "AI conversion failed. Check your AI configuration and try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
