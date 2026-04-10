import { NextResponse } from "next/server";
import { z } from "zod";

import { htmlToMarkdown } from "@/lib/convert/html-to-markdown";
import { emitJsonOutput } from "@/lib/emit/json-emitter";
import { extractPageContent } from "@/lib/extract/extract-page";
import type { ConversionResponse } from "@/lib/types/conversion";

export const runtime = "nodejs";

const conversionRequestSchema = z.object({
  sourceType: z.enum(["url", "html"]),
  source: z.string().min(1, "Source is required."),
  outputFormat: z.enum(["markdown", "json"]).default("markdown"),
  mainContentOnly: z.boolean().default(true),
});

export async function POST(request: Request) {
  try {
    const payload = conversionRequestSchema.parse(await request.json());
    if (payload.sourceType === "url") {
      try {
        new URL(payload.source);
      } catch {
        return NextResponse.json(
          { error: "Invalid URL format." },
          { status: 400 },
        );
      }
    }

    const extracted = await extractPageContent({
      sourceType: payload.sourceType,
      source: payload.source,
      mainContentOnly: payload.mainContentOnly,
    });

    const markdownBody = htmlToMarkdown(extracted.html);
    const meta = {
      sourceType: payload.sourceType,
      source: payload.sourceType === "url" ? payload.source : "Pasted HTML source",
      title: extracted.title,
      convertedAt: new Date().toISOString(),
    } as const;

    const markdown = [
      "---",
      `title: "${meta.title.replaceAll('"', '\\"')}"`,
      `sourceType: "${meta.sourceType}"`,
      `source: "${meta.source.replaceAll('"', '\\"')}"`,
      `convertedAt: "${meta.convertedAt}"`,
      "---",
      "",
      markdownBody,
    ].join("\n");

    const json = emitJsonOutput(markdown, meta, extracted.report);
    const response: ConversionResponse = {
      markdown,
      json,
      report: extracted.report,
      meta,
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
        : "Conversion failed. Make sure the source is reachable and valid.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

