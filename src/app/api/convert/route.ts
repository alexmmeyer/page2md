import { NextResponse } from "next/server";
import { z } from "zod";

import { htmlToMarkdown } from "@/lib/convert/html-to-markdown";
import { emitJsonOutput } from "@/lib/emit/json-emitter";
import { extractPageContent } from "@/lib/extract/extract-page";
import type { ConversionResponse } from "@/lib/types/conversion";

export const runtime = "nodejs";

const conversionRequestSchema = z.object({
  sourceType: z.enum(["url", "html", "paste"]),
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

    const convertedAt = new Date().toISOString();
    let markdownBody = "";
    let meta: {
      sourceType: "url" | "html" | "paste";
      source: string;
      title: string;
      convertedAt: string;
    };
    let report: {
      collapsiblesAttempted: number;
      collapsiblesOpened: number;
      sequentialGroupsDetected: number;
      warnings: string[];
    };

    if (payload.sourceType === "paste") {
      markdownBody = htmlToMarkdown(payload.source);
      meta = {
        sourceType: payload.sourceType,
        source: "Pasted snippet",
        title: "Pasted Snippet",
        convertedAt,
      };
      report = {
        collapsiblesAttempted: 0,
        collapsiblesOpened: 0,
        sequentialGroupsDetected: 0,
        warnings: [],
      };
    } else {
      const extracted = await extractPageContent({
        sourceType: payload.sourceType,
        source: payload.source,
        mainContentOnly: payload.mainContentOnly,
      });
      markdownBody = htmlToMarkdown(extracted.html);
      meta = {
        sourceType: payload.sourceType,
        source: payload.sourceType === "url" ? payload.source : "Pasted HTML source",
        title: extracted.title,
        convertedAt,
      };
      report = extracted.report;
    }

    const markdown =
      meta.sourceType === "paste"
        ? markdownBody
        : [
            "---",
            `title: "${meta.title.replaceAll('"', '\\"')}"`,
            `sourceType: "${meta.sourceType}"`,
            `source: "${meta.source.replaceAll('"', '\\"')}"`,
            `convertedAt: "${meta.convertedAt}"`,
            "---",
            "",
            markdownBody,
          ].join("\n");

    const response: ConversionResponse = {
      outputFormat: payload.outputFormat,
      markdown: payload.outputFormat === "markdown" ? markdown : undefined,
      json:
        payload.outputFormat === "json"
          ? emitJsonOutput(markdown, meta, report)
          : undefined,
      report,
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

