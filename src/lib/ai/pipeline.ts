import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import { htmlToMarkdown } from "@/lib/convert/html-to-markdown";
import { extractPageContent } from "@/lib/extract/extract-page";
import type {
  AiRegionCandidate,
  ConversionMeta,
  ConversionSourceType,
  ExtractionRegionKind,
  ExtractionRegion,
  ExtractionReport,
  OutputFormat,
} from "@/lib/types/conversion";

import {
  AI_CONVERT_TIMEOUT_MS,
  AI_DETECT_TIMEOUT_MS,
  getAiConvertModelName,
  getAiDetectModelName,
  getOpenAiClient,
} from "./client";
import { buildConvertSystemPrompt, buildConvertUserPrompt, buildDetectSystemPrompt, buildDetectUserPrompt } from "./prompts";
import { aiConvertCompletionSchema, aiDetectCompletionSchema } from "./schemas";

type DetectAiInput = {
  sourceType: ConversionSourceType;
  source: string;
  outputFormat: OutputFormat;
  preDetectedRegions?: ExtractionRegion[];
  titleHint?: string;
};

type ConvertAiInput = {
  sourceType: ConversionSourceType;
  source: string;
  outputFormat: OutputFormat;
  selectedRegionId?: string;
  selectedRegionHtml?: string;
  preDetectedRegions?: ExtractionRegion[];
  titleHint?: string;
};

type DetectAiResult = {
  meta: ConversionMeta;
  report: ExtractionReport;
  regions: ExtractionRegion[];
  aiRegions: AiRegionCandidate[];
  defaultRegionId?: string;
  selectedRegionId?: string;
  selectedRegionLabel?: string;
  model: string;
  aiWarnings: string[];
  fallbackUsed: boolean;
};

type ConvertAiResult = {
  markdownBody: string;
  report: ExtractionReport;
  meta: ConversionMeta;
  model: string;
  aiWarnings: string[];
  fallbackUsed: boolean;
};

type JsonObject = Record<string, unknown>;

const MAX_DETECT_CANDIDATES = 12;
const MAX_AI_HTML_CHARS = 16_000;
const MAX_AI_SOURCE_CHARS = 12_000;

function timeoutPromise<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    void promise
      .then((value) => {
        clearTimeout(timeout);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

function parseJsonContent(raw: string): JsonObject {
  const trimmed = raw.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch?.[1]?.trim() || trimmed;
  return JSON.parse(candidate) as JsonObject;
}

async function runJsonCompletion(args: {
  model: string;
  messages: ChatCompletionMessageParam[];
  timeoutMs: number;
}): Promise<JsonObject> {
  const client = getOpenAiClient();
  const completion = await timeoutPromise(
    client.chat.completions.create({
      model: args.model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: args.messages,
    }),
    args.timeoutMs,
    "AI request timed out. Try again.",
  );

  const content = completion.choices[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("AI returned an empty response.");
  }
  return parseJsonContent(content);
}

function zeroReport(): ExtractionReport {
  return {
    collapsiblesAttempted: 0,
    collapsiblesOpened: 0,
    sequentialGroupsDetected: 0,
    warnings: [],
  };
}

function normalizeSourceForMeta(sourceType: ConversionSourceType, source: string): string {
  if (sourceType === "paste") {
    return "Pasted snippet";
  }
  if (sourceType === "html") {
    return "Pasted HTML source";
  }
  return source;
}

function clampRegionCandidates(regions: ExtractionRegion[]): ExtractionRegion[] {
  const byScore = regions.slice().sort((a, b) => b.score - a.score);
  const preserveKinds: ExtractionRegionKind[] = ["toc", "navigation", "sidebar"];
  const selectedIds = new Set<string>();
  const selected: ExtractionRegion[] = [];

  for (const kind of preserveKinds) {
    const match = byScore.find((region) => region.kind === kind);
    if (!match || selectedIds.has(match.id)) {
      continue;
    }
    selected.push(match);
    selectedIds.add(match.id);
  }

  for (const region of byScore) {
    if (selectedIds.has(region.id)) {
      continue;
    }
    selected.push(region);
    selectedIds.add(region.id);
    if (selected.length >= MAX_DETECT_CANDIDATES) {
      break;
    }
  }

  return selected;
}

function fallbackAiRegions(regions: ExtractionRegion[]): AiRegionCandidate[] {
  const fallbackDescription = (region: ExtractionRegion) => {
    if (region.previewText && region.previewText.trim().length > 0) {
      return region.previewText.trim();
    }
    return `${region.kind} content`;
  };
  return regions.slice(0, 4).map((region, index) => ({
    id: `ai-${region.id}`,
    sourceRegionId: region.id,
    label: region.label,
    description: fallbackDescription(region),
    confidence: Math.max(0.5, 0.92 - index * 0.12),
    score: Math.max(1, Math.min(100, Math.round(region.score / 200))),
    rationale: "Deterministic fallback ranking was used for this region.",
  }));
}

function normalizeAiDescription(description: string | undefined, sourceRegion: ExtractionRegion): string {
  const cleaned = (description ?? "").trim();
  const labelLower = sourceRegion.label.trim().toLowerCase();
  if (!cleaned) {
    return sourceRegion.previewText?.trim() || `${sourceRegion.kind} content`;
  }
  const cleanedLower = cleaned.toLowerCase();
  const isGenericRegionDescription =
    cleanedLower === `${labelLower} region` ||
    cleanedLower === `${sourceRegion.kind} region` ||
    cleanedLower === labelLower ||
    /(^|\s)region$/.test(cleanedLower);
  if (isGenericRegionDescription) {
    return sourceRegion.previewText?.trim() || `${sourceRegion.kind} content`;
  }
  return cleaned;
}

function trimInput(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n<!-- truncated for token budget -->`;
}

function titleForSource(sourceType: ConversionSourceType, fallback: string | undefined): string {
  if (fallback && fallback.trim().length > 0) {
    return fallback.trim();
  }
  if (sourceType === "paste") {
    return "Pasted Snippet";
  }
  if (sourceType === "html") {
    return "HTML Source";
  }
  return "Untitled Page";
}

export async function detectRegionsWithAi(input: DetectAiInput): Promise<DetectAiResult> {
  const convertedAt = new Date().toISOString();
  let title = titleForSource(input.sourceType, input.titleHint);
  let regions = clampRegionCandidates(input.preDetectedRegions ?? []);
  let report: ExtractionReport = zeroReport();

  if (regions.length === 0) {
    if (input.sourceType === "tab") {
      throw new Error("AI detect for tab sources requires pre-detected regions from the extension.");
    }
    if (input.sourceType === "paste") {
      const sourceSnippet = trimInput(input.source, MAX_AI_SOURCE_CHARS);
      regions = [
        {
          id: "paste-snippet",
          label: "Pasted snippet",
          kind: "content",
          textLength: sourceSnippet.length,
          linkDensity: 0,
          score: 1000,
        },
      ];
      report = zeroReport();
    } else {
      const extracted = await extractPageContent({
        sourceType: input.sourceType,
        source: input.source,
        mainContentOnly: false,
      });
      title = extracted.title || title;
      report = extracted.report;
      regions = clampRegionCandidates(extracted.regions);
    }
  }

  const detectPayload = buildDetectUserPrompt({
    title,
    source: normalizeSourceForMeta(input.sourceType, input.source),
    candidates: regions,
  });
  let aiRegions: AiRegionCandidate[] = [];
  let aiWarnings: string[] = [];
  let fallbackUsed = false;
  const model = getAiDetectModelName();

  try {
    const raw = await runJsonCompletion({
      model,
      timeoutMs: AI_DETECT_TIMEOUT_MS,
      messages: [
        { role: "system", content: buildDetectSystemPrompt() },
        { role: "user", content: detectPayload },
      ],
    });
    const parsed = aiDetectCompletionSchema.parse(raw);
    aiWarnings = parsed.warnings ?? [];
    const byId = new Map(regions.map((region) => [region.id, region]));
    const mappedRegions: AiRegionCandidate[] = [];
    for (const region of parsed.regions) {
      if (!region.include) {
        continue;
      }
      const sourceRegion = byId.get(region.sourceRegionId);
      if (!sourceRegion) {
        continue;
      }
      mappedRegions.push({
        id: `ai-${region.sourceRegionId}`,
        sourceRegionId: region.sourceRegionId,
        label: region.label,
        description: normalizeAiDescription(region.description, sourceRegion),
        confidence: region.confidence,
        score: region.score,
        rationale: region.rationale,
      });
      if (mappedRegions.length >= 6) {
        break;
      }
    }
    aiRegions = mappedRegions;
  } catch {
    fallbackUsed = true;
    aiWarnings = ["AI detection fallback was used due to model error or invalid output."];
    aiRegions = fallbackAiRegions(regions);
  }

  if (aiRegions.length === 0) {
    fallbackUsed = true;
    aiWarnings.push("No AI regions were selected; deterministic fallback ranking was used.");
    aiRegions = fallbackAiRegions(regions);
  }

  const top = aiRegions[0];
  const sourceRegionLabel = regions.find((region) => region.id === top?.sourceRegionId)?.label;
  const meta: ConversionMeta = {
    sourceType: input.sourceType,
    source: normalizeSourceForMeta(input.sourceType, input.source),
    title,
    convertedAt,
    selectedRegionId: top?.sourceRegionId,
    selectedRegionLabel: sourceRegionLabel ?? top?.label,
  };

  return {
    meta,
    report,
    regions,
    aiRegions,
    defaultRegionId: top?.sourceRegionId,
    selectedRegionId: top?.sourceRegionId,
    selectedRegionLabel: sourceRegionLabel ?? top?.label,
    model,
    aiWarnings,
    fallbackUsed,
  };
}

export async function convertRegionWithAi(input: ConvertAiInput): Promise<ConvertAiResult> {
  const convertedAt = new Date().toISOString();
  let html = input.selectedRegionHtml ?? "";
  let title = titleForSource(input.sourceType, input.titleHint);
  let selectedRegionLabel = "Selected content";
  let selectedRegionId = input.selectedRegionId;
  let report: ExtractionReport = zeroReport();

  if (!html.trim()) {
    if (input.sourceType === "tab") {
      throw new Error("AI convert for tab sources requires selectedRegionHtml from the extension.");
    }
    if (input.sourceType === "paste") {
      html = input.source;
      selectedRegionLabel = "Pasted snippet";
    } else {
      const extracted = await extractPageContent({
        sourceType: input.sourceType,
        source: input.source,
        mainContentOnly: false,
        selectedRegionId: input.selectedRegionId,
      });
      html = extracted.html;
      title = extracted.title || title;
      selectedRegionId = extracted.selectedRegionId ?? selectedRegionId;
      selectedRegionLabel = extracted.selectedRegionLabel ?? selectedRegionLabel;
      report = extracted.report;
    }
  } else {
    const preRegion = input.preDetectedRegions?.find((region) => region.id === input.selectedRegionId);
    if (preRegion?.label) {
      selectedRegionLabel = preRegion.label;
    }
  }

  const boundedHtml = trimInput(html, MAX_AI_HTML_CHARS);
  const model = getAiConvertModelName();
  let fallbackUsed = false;
  let aiWarnings: string[] = [];
  let markdownBody = "";

  try {
    const raw = await runJsonCompletion({
      model,
      timeoutMs: AI_CONVERT_TIMEOUT_MS,
      messages: [
        { role: "system", content: buildConvertSystemPrompt() },
        {
          role: "user",
          content: buildConvertUserPrompt({
            source: normalizeSourceForMeta(input.sourceType, input.source),
            title,
            selectedRegionLabel,
            html: boundedHtml,
          }),
        },
      ],
    });
    const parsed = aiConvertCompletionSchema.parse(raw);
    markdownBody = parsed.markdown.trim();
    aiWarnings = parsed.warnings ?? [];
    if (parsed.title && parsed.title.trim().length > 0) {
      title = parsed.title.trim();
    }
  } catch {
    fallbackUsed = true;
    aiWarnings = ["AI markdown generation failed; deterministic fallback markdown was used."];
    markdownBody = htmlToMarkdown(html);
  }

  if (!markdownBody.trim()) {
    fallbackUsed = true;
    aiWarnings.push("AI markdown output was empty; deterministic fallback markdown was used.");
    markdownBody = htmlToMarkdown(html);
  }

  const meta: ConversionMeta = {
    sourceType: input.sourceType,
    source: normalizeSourceForMeta(input.sourceType, input.source),
    title,
    convertedAt,
    selectedRegionId,
    selectedRegionLabel,
  };

  return {
    markdownBody,
    report,
    meta,
    model,
    aiWarnings,
    fallbackUsed,
  };
}
