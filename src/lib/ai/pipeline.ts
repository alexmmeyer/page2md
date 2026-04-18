import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import { htmlToMarkdown } from "@/lib/convert/html-to-markdown";
import {
  extractForAiConvert,
  extractForAiDetect,
  extractPageContent,
} from "@/lib/extract/extract-page";
import type {
  AiRegionCandidate,
  ConversionMeta,
  ConversionSourceType,
  ExtractionRegionKind,
  ExtractionRegion,
  ExtractionReport,
  OutputFormat,
  VisibleRegionCandidate,
} from "@/lib/types/conversion";

import {
  AI_CLEAN_TIMEOUT_MS,
  AI_DETECT_TIMEOUT_MS,
  getAiCleanModelName,
  getAiDetectModelName,
  getOpenAiClient,
} from "./client";
import {
  buildCleanupSystemPrompt,
  buildCleanupUserPrompt,
  buildDetectSystemPrompt,
  buildLegacyDetectUserPrompt,
  buildVisionDetectUserPrompt,
} from "./prompts";
import { aiCleanupCompletionSchema, aiDetectCompletionSchema } from "./schemas";
import type { AiDetectCompletion } from "./schemas";

const IS_DEV = process.env.NODE_ENV === "development";

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

/**
 * Models occasionally return field names that differ from the schema.
 * Normalize common variations before Zod parsing so we don't silently fall back.
 *
 * Top-level: AI may put the array under `regions`, `results`, `items`,
 * `candidates`, or `data` depending on phrasing.
 *
 * Per-region: `sourceRegionId` is aliased from `ref`, `id`, etc.
 * `rationale` is aliased from `reason`, `justification`, etc.
 */
function normalizeRawDetectResponse(raw: JsonObject): JsonObject {
  const arrayKeys = ["regions", "results", "items", "candidates", "data"] as const;
  let regions: unknown[] = [];
  let foundKey: string | null = null;
  for (const key of arrayKeys) {
    if (Array.isArray(raw[key])) {
      regions = raw[key] as unknown[];
      foundKey = key;
      break;
    }
  }
  if (!foundKey && IS_DEV) {
    const topLevelKeys = Object.keys(raw).join(", ");
    console.warn(
      `[page2md]   ⚠ AI detect response has no recognized array field. Top-level keys: [${topLevelKeys}]. Expected one of: ${arrayKeys.join(", ")}.`,
    );
  }

  const normalized = regions
    .filter((r): r is JsonObject => typeof r === "object" && r !== null)
    .map((r) => ({
      ...r,
      sourceRegionId:
        r.sourceRegionId ??
        r.ref ??
        r.regionRef ??
        r.candidateRef ??
        r.regionId ??
        r.id ??
        r.source_region_id ??
        r.region_id,
      rationale:
        r.rationale ??
        r.reason ??
        r.justification ??
        r.reasoning_summary ??
        r.explanation ??
        "",
    }));
  return { ...raw, regions: normalized };
}

function logDevRegionAnalysis(
  title: string,
  source: string,
  parsed: AiDetectCompletion,
  candidateMap: Map<string, ExtractionRegion>,
): void {
  const divider = "─".repeat(72);
  const included = parsed.regions.filter((r) => r.include);
  const excluded = parsed.regions.filter((r) => !r.include);

  console.log(`\n${divider}`);
  console.log(`\x1b[1m[page2md] AI Region Analysis\x1b[0m`);
  console.log(`  Title:  ${title}`);
  console.log(`  Source: ${source}`);
  console.log(divider);

  if (included.length === 0) {
    console.log(`  \x1b[33m⚠ No regions were included by the AI.\x1b[0m`);
  }

  for (const region of included) {
    const src = candidateMap.get(region.sourceRegionId);
    const meta = src
      ? `kind=${src.kind} | ${src.textLength} chars | linkDensity=${src.linkDensity.toFixed(3)} | hScore=${src.score}`
      : `sourceRegionId=${region.sourceRegionId}`;
    console.log(
      `\n  \x1b[32m✓ INCLUDED\x1b[0m  "${region.label}"  \x1b[2m(${region.sourceRegionId})\x1b[0m`,
    );
    console.log(`  \x1b[2m${meta}\x1b[0m`);
    console.log(`  Description: ${region.description}`);
    console.log(`  Confidence:  ${region.confidence.toFixed(2)} | Score: ${region.score}`);
    if (region.reasoning) {
      console.log(`  \x1b[36mPurpose:\x1b[0m     ${region.reasoning.purpose}`);
      console.log(`  \x1b[36mImportance:\x1b[0m  ${region.reasoning.importance}`);
      console.log(`  \x1b[36mNo overlap:\x1b[0m  ${region.reasoning.nonOverlap}`);
      console.log(`  \x1b[36mAtomicity:\x1b[0m   ${region.reasoning.atomicity}`);
    } else {
      console.log(`  Rationale:   ${region.rationale}`);
    }
  }

  if (excluded.length > 0) {
    console.log(`\n  ${divider.slice(0, 40)}`);
    console.log(`  \x1b[2mExcluded candidates:\x1b[0m`);
    for (const region of excluded) {
      const src = candidateMap.get(region.sourceRegionId);
      const meta = src ? `kind=${src.kind} | ${src.textLength} chars` : region.sourceRegionId;
      console.log(
        `  \x1b[31m✗ EXCLUDED\x1b[0m  "${region.label}"  \x1b[2m(${meta})\x1b[0m`,
      );
      if (region.reasoning) {
        console.log(`    Purpose:    ${region.reasoning.purpose}`);
        console.log(`    Importance: ${region.reasoning.importance}`);
      } else {
        console.log(`    Rationale:  ${region.rationale}`);
      }
    }
  }

  if (parsed.warnings && parsed.warnings.length > 0) {
    console.log(`\n  \x1b[33mAI warnings: ${parsed.warnings.join("; ")}\x1b[0m`);
  }

  console.log(`\n${divider}\n`);
}

function logDevVisionRegionAnalysis(
  title: string,
  source: string,
  parsed: AiDetectCompletion,
  candidatesByRef: Map<string, VisibleRegionCandidate>,
): void {
  const divider = "─".repeat(72);
  const included = parsed.regions.filter((r) => r.include);
  const excluded = parsed.regions.filter((r) => !r.include);

  console.log(`\n${divider}`);
  console.log(`\x1b[1m[page2md] AI Vision Region Analysis\x1b[0m`);
  console.log(`  Title:  ${title}`);
  console.log(`  Source: ${source}`);
  console.log(divider);

  if (included.length === 0) {
    console.log(`  \x1b[33m⚠ No regions were included by the AI.\x1b[0m`);
  }

  for (const region of included) {
    const c = candidatesByRef.get(region.sourceRegionId);
    const meta = c
      ? `${c.tag} | bbox=(${c.bbox.x},${c.bbox.y},${c.bbox.width}x${c.bbox.height}) | bg=${c.bgColor} | ${c.textLength} chars | linkDensity=${c.linkDensity.toFixed(3)}`
      : `ref=${region.sourceRegionId} (not in candidate map!)`;
    console.log(
      `\n  \x1b[32m✓ INCLUDED\x1b[0m  "${region.label}"  \x1b[2m(ref ${region.sourceRegionId})\x1b[0m`,
    );
    console.log(`  \x1b[2m${meta}\x1b[0m`);
    if (c) {
      console.log(`  \x1b[2mselectorPath: ${c.selectorPath}\x1b[0m`);
    }
    console.log(`  Description: ${region.description}`);
    console.log(`  Confidence:  ${region.confidence.toFixed(2)} | Score: ${region.score}`);
    if (region.reasoning) {
      console.log(`  \x1b[36mPurpose:\x1b[0m     ${region.reasoning.purpose}`);
      console.log(`  \x1b[36mImportance:\x1b[0m  ${region.reasoning.importance}`);
      console.log(`  \x1b[36mNo overlap:\x1b[0m  ${region.reasoning.nonOverlap}`);
      console.log(`  \x1b[36mAtomicity:\x1b[0m   ${region.reasoning.atomicity}`);
    } else if (region.rationale) {
      console.log(`  Rationale:   ${region.rationale}`);
    }
  }

  if (excluded.length > 0) {
    console.log(`\n  ${divider.slice(0, 40)}`);
    console.log(`  \x1b[2mExcluded candidates:\x1b[0m`);
    for (const region of excluded) {
      const c = candidatesByRef.get(region.sourceRegionId);
      const meta = c
        ? `${c.tag} | ${c.textLength} chars | bbox=(${c.bbox.x},${c.bbox.y},${c.bbox.width}x${c.bbox.height})`
        : region.sourceRegionId;
      console.log(
        `  \x1b[31m✗ EXCLUDED\x1b[0m  "${region.label}"  \x1b[2m(${meta})\x1b[0m`,
      );
      if (region.reasoning) {
        console.log(`    Purpose:    ${region.reasoning.purpose}`);
        console.log(`    Importance: ${region.reasoning.importance}`);
      } else if (region.rationale) {
        console.log(`    Rationale:  ${region.rationale}`);
      }
    }
  }

  if (parsed.warnings && parsed.warnings.length > 0) {
    console.log(`\n  \x1b[33mAI warnings: ${parsed.warnings.join("; ")}\x1b[0m`);
  }

  console.log(`\n${divider}\n`);
}

/**
 * Build a synthetic ExtractionRegion from a vision candidate so the existing
 * client UI (which merges aiRegions with deterministic regions) keeps
 * working. The region's `id` is the candidate's selectorPath — that's what
 * comes back as `selectedRegionId` from the convert call.
 */
function visionCandidateToExtractionRegion(
  candidate: VisibleRegionCandidate,
  aiLabel: string,
  aiScore: number,
  aiDescription: string,
): ExtractionRegion {
  const kind: ExtractionRegionKind = (() => {
    const tag = candidate.tag.toLowerCase();
    const role = (candidate.role || "").toLowerCase();
    if (tag === "main" || role === "main") return "main";
    if (tag === "article") return "article";
    if (tag === "nav" || role === "navigation") return "navigation";
    if (tag === "header") return "header";
    if (tag === "footer") return "footer";
    if (tag === "aside" || role === "complementary") return "sidebar";
    return "content";
  })();
  return {
    id: candidate.selectorPath,
    label: aiLabel,
    description: aiDescription,
    previewText: candidate.textPreview,
    kind,
    textLength: candidate.textLength,
    linkDensity: candidate.linkDensity,
    score: aiScore,
  };
}

/**
 * Drop candidates that are pure wrappers. A candidate is a wrapper when any
 * of its immediate child candidates (as recorded in `childRefs`) has
 * textLength ≥ 90% of the parent's. Sending wrappers to the AI inflates the
 * prompt with redundant entries and causes it to pick broad containers instead
 * of the precise inner regions the user actually wants.
 */
function filterWrapperCandidates(
  candidates: VisibleRegionCandidate[],
): VisibleRegionCandidate[] {
  const byRef = new Map(candidates.map((c) => [c.ref, c]));
  const wrapperRefs = new Set<string>();
  for (const c of candidates) {
    for (const childRef of c.childRefs) {
      const child = byRef.get(childRef);
      if (child && child.textLength >= c.textLength * 0.9) {
        wrapperRefs.add(c.ref);
        break;
      }
    }
  }
  return candidates.filter((c) => !wrapperRefs.has(c.ref));
}

async function detectRegionsVision(input: DetectAiInput): Promise<DetectAiResult> {
  const convertedAt = new Date().toISOString();
  if (input.sourceType !== "url" && input.sourceType !== "html") {
    throw new Error("Vision detect only supports url and html source types.");
  }
  if (IS_DEV) {
    console.log(`[page2md]   Rendering page in headless Chromium for vision-based detection...`);
  }
  const extractStart = Date.now();
  const extracted = await extractForAiDetect({
    sourceType: input.sourceType,
    source: input.source,
  });
  if (IS_DEV) {
    console.log(`[page2md]   Vision extraction complete in ${Date.now() - extractStart}ms`);
    console.log(`[page2md]   Page title: "${extracted.title}"  candidates: ${extracted.candidates.length}  screenshot: ${Math.round(extracted.screenshotPngBase64.length / 1024)} KB`);
  }

  const title = extracted.title || titleForSource(input.sourceType, input.titleHint);
  const normalizedSource = normalizeSourceForMeta(input.sourceType, input.source);
  const promptOpts = { devMode: IS_DEV };

  // Remove pure wrapper candidates before sending to the AI. A candidate is a
  // wrapper when one of its direct child candidates contains ≥90% of its text —
  // the child is strictly more informative. Pruning wrappers shrinks the
  // candidate list by ~30–50% on typical pages, reducing prompt tokens and
  // the likelihood of the AI picking a broad container instead of the precise
  // inner region.
  const filteredCandidates = filterWrapperCandidates(extracted.candidates);
  if (IS_DEV && filteredCandidates.length < extracted.candidates.length) {
    console.log(
      `[page2md]   Pre-filter removed ${extracted.candidates.length - filteredCandidates.length} wrapper candidate(s) (${filteredCandidates.length} remain)`,
    );
  }

  const candidatesByRef = new Map(extracted.candidates.map((c) => [c.ref, c]));

  const userPrompt = buildVisionDetectUserPrompt(
    {
      title,
      source: normalizedSource,
      candidates: filteredCandidates,
      viewport: extracted.viewport,
      fullPageHeight: extracted.fullPageHeight,
    },
    promptOpts,
  );

  const model = getAiDetectModelName();
  let aiRegions: AiRegionCandidate[] = [];
  let aiWarnings: string[] = [];
  let fallbackUsed = false;

  if (IS_DEV) {
    console.log(`[page2md]   Sending screenshot + ${filteredCandidates.length} candidate(s) to ${model} for vision-based region analysis...`);
  }
  const aiDetectStart = Date.now();

  try {
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: buildDetectSystemPrompt(promptOpts) },
      {
        role: "user",
        content: [
          { type: "text", text: userPrompt },
          {
            type: "image_url",
            image_url: {
              url: `data:image/png;base64,${extracted.screenshotPngBase64}`,
              // "low" uses a fixed 85-token tile regardless of image size.
              // Layout reasoning (sidebar vs main vs TOC) doesn't require
              // high-res detail; the candidate metadata carries that context.
              // Using "high" on a tall full-page screenshot can exhaust the
              // vision token budget and cause timeouts.
              detail: "low",
            },
          },
        ],
      },
    ];

    const raw = await runJsonCompletion({
      model,
      timeoutMs: AI_DETECT_TIMEOUT_MS,
      messages,
    });

    if (IS_DEV) {
      console.log(`[page2md]   AI responded in ${Date.now() - aiDetectStart}ms — parsing response...`);
      console.log(`[page2md]   Raw AI response:\n${JSON.stringify(raw, null, 2)}`);
    }
    const parsed = aiDetectCompletionSchema.parse(normalizeRawDetectResponse(raw));
    aiWarnings = parsed.warnings ?? [];

    if (IS_DEV) {
      logDevVisionRegionAnalysis(title, normalizedSource, parsed, candidatesByRef);
    }

    const mapped: AiRegionCandidate[] = [];
    for (const region of parsed.regions) {
      if (!region.include) continue;
      const candidate = candidatesByRef.get(region.sourceRegionId);
      if (!candidate) {
        if (IS_DEV) {
          console.warn(`[page2md]   AI returned unknown ref "${region.sourceRegionId}" — skipping.`);
        }
        continue;
      }
      mapped.push({
        id: `ai-${candidate.selectorPath}`,
        sourceRegionId: candidate.selectorPath,
        label: region.label,
        description: region.description,
        confidence: region.confidence,
        score: region.score,
        rationale: region.rationale,
      });
      if (mapped.length >= 6) break;
    }
    aiRegions = mapped;
  } catch (err) {
    fallbackUsed = true;
    const reason = err instanceof Error ? err.message : String(err);
    aiWarnings = [
      `AI region detection failed (${reason}). Falling back to a heuristic best-guess — the suggested regions may be inaccurate. Try again, or use deterministic conversion.`,
    ];
    aiRegions = fallbackVisionRegions(extracted.candidates);
    if (IS_DEV) {
      console.error(`[page2md]   detectRegionsVision — AI call or schema parse FAILED, using fallback. Error:`, err);
    }
  }

  if (aiRegions.length === 0) {
    fallbackUsed = true;
    aiWarnings.push(
      "AI returned no usable regions for this page. Falling back to a heuristic best-guess — the suggested regions may be inaccurate.",
    );
    aiRegions = fallbackVisionRegions(extracted.candidates);
    if (IS_DEV) {
      console.warn(`[page2md]   detectRegionsVision — AI returned no included regions, using fallback.`);
    }
  }

  // Build synthetic ExtractionRegion[] so the existing client UI works.
  const regions: ExtractionRegion[] = aiRegions
    .map((aiRegion) => {
      const candidate = candidatesByRef.get(aiRegion.sourceRegionId ?? "")
        // sourceRegionId here is the selectorPath; lookup by selectorPath instead
        ?? extracted.candidates.find((c) => c.selectorPath === aiRegion.sourceRegionId);
      if (!candidate) return null;
      return visionCandidateToExtractionRegion(
        candidate,
        aiRegion.label,
        aiRegion.score,
        aiRegion.description ?? "",
      );
    })
    .filter((r): r is ExtractionRegion => r !== null);

  const top = aiRegions[0];
  const meta: ConversionMeta = {
    sourceType: input.sourceType,
    source: normalizedSource,
    title,
    convertedAt,
    selectedRegionId: top?.sourceRegionId,
    selectedRegionLabel: top?.label,
  };

  return {
    meta,
    report: extracted.report,
    regions,
    aiRegions,
    defaultRegionId: top?.sourceRegionId,
    selectedRegionId: top?.sourceRegionId,
    selectedRegionLabel: top?.label,
    model,
    aiWarnings,
    fallbackUsed,
  };
}

/**
 * Deterministic best-guess regions when the AI vision call fails.
 *
 * Strategy:
 *   1. Order candidates by a "content-likelihood" score that prefers
 *      semantic tags (main/article/nav/aside/section) over plain divs and
 *      penalizes near-empty wrappers.
 *   2. Walk that list and keep a candidate only if it doesn't substantially
 *      overlap one we've already kept (parent/child relationship via
 *      childRefs, or text-length similarity above 85%).
 *   3. Generate human-friendly labels from semantic tag, role, or aria-label
 *      — never bare `div block`.
 */
function fallbackVisionRegions(
  candidates: VisibleRegionCandidate[],
): AiRegionCandidate[] {
  if (candidates.length === 0) {
    return [];
  }

  const semanticTagBonus: Record<string, number> = {
    main: 1000,
    article: 900,
    nav: 600,
    aside: 600,
    section: 400,
    header: 300,
    footer: 200,
  };

  const scoreOf = (c: VisibleRegionCandidate) => {
    const tagBonus = semanticTagBonus[c.tag] ?? 0;
    const roleBonus =
      c.role === "main"
        ? 800
        : c.role === "navigation"
          ? 500
          : c.role === "complementary"
            ? 400
            : 0;
    const ariaBonus = c.ariaLabel ? 150 : 0;
    const linkPenalty = c.linkDensity * 600;
    return c.textLength + tagBonus + roleBonus + ariaBonus - linkPenalty;
  };

  const ranked = candidates.slice().sort((a, b) => scoreOf(b) - scoreOf(a));

  const tagToFriendlyLabel: Record<string, string> = {
    main: "Main content",
    article: "Article",
    nav: "Navigation",
    aside: "Sidebar",
    header: "Header",
    footer: "Footer",
    section: "Section",
  };

  const friendlyLabel = (c: VisibleRegionCandidate, fallbackIndex: number): string => {
    if (c.ariaLabel && c.ariaLabel.trim().length > 0) {
      return c.ariaLabel.trim().slice(0, 60);
    }
    if (c.role && c.role.length > 0) {
      const role = c.role.charAt(0).toUpperCase() + c.role.slice(1);
      return role;
    }
    if (tagToFriendlyLabel[c.tag]) {
      return tagToFriendlyLabel[c.tag];
    }
    return `Content region ${fallbackIndex + 1}`;
  };

  const kept: VisibleRegionCandidate[] = [];
  const isOverlapping = (a: VisibleRegionCandidate, b: VisibleRegionCandidate) => {
    if (a.childRefs.includes(b.ref) || b.childRefs.includes(a.ref)) {
      return true;
    }
    const bigger = Math.max(a.textLength, b.textLength);
    const smaller = Math.min(a.textLength, b.textLength);
    if (bigger === 0) {
      return false;
    }
    return smaller / bigger > 0.85;
  };

  for (const candidate of ranked) {
    if (kept.some((existing) => isOverlapping(existing, candidate))) {
      continue;
    }
    kept.push(candidate);
    if (kept.length >= 4) break;
  }

  return kept.map((c, i) => ({
    id: `ai-${c.selectorPath}`,
    sourceRegionId: c.selectorPath,
    label: friendlyLabel(c, i),
    description: c.textPreview || `${c.tag} content`,
    confidence: Math.max(0.4, 0.75 - i * 0.1),
    score: Math.max(1, Math.min(100, 75 - i * 10)),
    rationale: "Heuristic best-guess (AI unavailable). Verify the region matches what you want.",
  }));
}

async function detectRegionsLegacy(input: DetectAiInput): Promise<DetectAiResult> {
  // Used for paste/tab sources only. Keeps the previous heuristic-then-AI flow.
  const convertedAt = new Date().toISOString();
  const title = titleForSource(input.sourceType, input.titleHint);
  let regions = clampRegionCandidates(input.preDetectedRegions ?? []);
  const report: ExtractionReport = zeroReport();

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
    }
  }

  const normalizedSource = normalizeSourceForMeta(input.sourceType, input.source);
  const promptOpts = { devMode: IS_DEV };
  const detectPayload = buildLegacyDetectUserPrompt(
    { title, source: normalizedSource, candidates: regions },
    promptOpts,
  );
  let aiRegions: AiRegionCandidate[] = [];
  let aiWarnings: string[] = [];
  let fallbackUsed = false;
  const model = getAiDetectModelName();

  try {
    const raw = await runJsonCompletion({
      model,
      timeoutMs: AI_DETECT_TIMEOUT_MS,
      messages: [
        { role: "system", content: buildDetectSystemPrompt(promptOpts) },
        { role: "user", content: detectPayload },
      ],
    });
    const parsed = aiDetectCompletionSchema.parse(normalizeRawDetectResponse(raw));
    aiWarnings = parsed.warnings ?? [];
    const byId = new Map(regions.map((region) => [region.id, region]));

    if (IS_DEV) {
      logDevRegionAnalysis(title, normalizedSource, parsed, byId);
    }

    const mappedRegions: AiRegionCandidate[] = [];
    for (const region of parsed.regions) {
      if (!region.include) continue;
      const sourceRegion = byId.get(region.sourceRegionId);
      if (!sourceRegion) continue;
      mappedRegions.push({
        id: `ai-${region.sourceRegionId}`,
        sourceRegionId: region.sourceRegionId,
        label: region.label,
        description: normalizeAiDescription(region.description, sourceRegion),
        confidence: region.confidence,
        score: region.score,
        rationale: region.rationale,
      });
      if (mappedRegions.length >= 6) break;
    }
    aiRegions = mappedRegions;
  } catch (err) {
    fallbackUsed = true;
    aiWarnings = ["AI detection fallback was used due to model error or invalid output."];
    aiRegions = fallbackAiRegions(regions);
    if (IS_DEV) {
      console.error(`[page2md]   detectRegionsLegacy — AI call FAILED, using fallback.`, err);
    }
  }

  if (aiRegions.length === 0) {
    fallbackUsed = true;
    aiWarnings.push("No AI regions were selected; deterministic fallback ranking was used.");
    aiRegions = fallbackAiRegions(regions);
  }

  const top = aiRegions[0];
  const sourceRegionLabel = regions.find((r) => r.id === top?.sourceRegionId)?.label;
  const meta: ConversionMeta = {
    sourceType: input.sourceType,
    source: normalizedSource,
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

export async function detectRegionsWithAi(input: DetectAiInput): Promise<DetectAiResult> {
  if (input.sourceType === "url" || input.sourceType === "html") {
    return detectRegionsVision(input);
  }
  return detectRegionsLegacy(input);
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
      if (IS_DEV) {
        console.log(`[page2md]   Source is pasted text (${html.length} chars) — skipping browser`);
      }
    } else if (input.sourceType === "url" || input.sourceType === "html") {
      if (IS_DEV) {
        console.log(`[page2md]   Re-rendering page in headless Chromium to extract selected region (vision flow)...`);
        console.log(`[page2md]   selectedRegionId=${input.selectedRegionId ?? "(none)"}`);
      }
      if (!input.selectedRegionId) {
        throw new Error("Convert with AI requires a selected region. Choose one before converting.");
      }
      const extractStart = Date.now();
      const extracted = await extractForAiConvert({
        sourceType: input.sourceType,
        source: input.source,
        selectorPath: input.selectedRegionId,
        labelHint: input.preDetectedRegions?.find((r) => r.id === input.selectedRegionId)?.label,
      });
      if (IS_DEV) {
        console.log(`[page2md]   Re-extraction complete in ${Date.now() - extractStart}ms — got ${extracted.html.length} chars of HTML for "${extracted.selectedRegionLabel}"`);
      }
      html = extracted.html;
      title = extracted.title || title;
      selectedRegionId = extracted.selectedRegionRef;
      selectedRegionLabel = extracted.selectedRegionLabel;
      report = extracted.report;
    } else {
      if (IS_DEV) {
        console.log(`[page2md]   No HTML provided — re-rendering page in headless Chromium to extract selected region...`);
        console.log(`[page2md]   selectedRegionId=${input.selectedRegionId ?? "(none)"}`);
      }
      const extractStart = Date.now();
      const extracted = await extractPageContent({
        sourceType: input.sourceType,
        source: input.source,
        mainContentOnly: false,
        selectedRegionId: input.selectedRegionId,
      });
      if (IS_DEV) {
        console.log(`[page2md]   Re-extraction complete in ${Date.now() - extractStart}ms — got ${extracted.html.length} chars of HTML for "${extracted.selectedRegionLabel}"`);
      }
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
    if (IS_DEV) {
      console.log(`[page2md]   HTML provided by caller (${html.length} chars) — skipping browser`);
    }
  }

  // ── Stage 4: Deterministic HTML → Markdown ─────────────────────────────
  // No AI in this step. htmlToMarkdown handles arbitrary HTML size faithfully
  // and cannot hallucinate content, so we never need to truncate.
  if (IS_DEV) {
    console.log(`[page2md]   Running deterministic htmlToMarkdown on ${html.length} chars of HTML for "${selectedRegionLabel}"...`);
  }
  const turndownStart = Date.now();
  const deterministicMarkdown = htmlToMarkdown(html);
  if (IS_DEV) {
    console.log(`[page2md]   Deterministic conversion produced ${deterministicMarkdown.length} chars of markdown in ${Date.now() - turndownStart}ms`);
  }

  // ── Stage 5: AI Cleanup ────────────────────────────────────────────────
  // Strip UI cruft and normalize structure. Strict prompt forbids authorship
  // of new content. If the cleanup output looks suspicious (e.g. shorter than
  // expected, or longer than the input), we fall back to the deterministic
  // markdown so we never serve hallucinated content.
  const model = getAiCleanModelName();
  let fallbackUsed = false;
  const aiWarnings: string[] = [];
  let markdownBody = deterministicMarkdown;

  if (deterministicMarkdown.trim().length === 0) {
    if (IS_DEV) {
      console.warn(`[page2md]   Deterministic conversion produced no markdown — skipping cleanup pass.`);
    }
    fallbackUsed = true;
    aiWarnings.push("The selected region produced no markdown after deterministic conversion.");
  } else {
    const cleanupStart = Date.now();
    if (IS_DEV) {
      console.log(`[page2md]   Sending ${deterministicMarkdown.length} chars of deterministic markdown to ${model} for cleanup pass...`);
    }
    try {
      const raw = await runJsonCompletion({
        model,
        timeoutMs: AI_CLEAN_TIMEOUT_MS,
        messages: [
          { role: "system", content: buildCleanupSystemPrompt() },
          {
            role: "user",
            content: buildCleanupUserPrompt({
              source: normalizeSourceForMeta(input.sourceType, input.source),
              title,
              selectedRegionLabel,
              markdown: deterministicMarkdown,
            }),
          },
        ],
      });
      if (IS_DEV) {
        console.log(`[page2md]   Cleanup AI responded in ${Date.now() - cleanupStart}ms — validating...`);
      }
      const parsed = aiCleanupCompletionSchema.parse(raw);
      const cleaned = parsed.markdown.trim();
      const inputLen = deterministicMarkdown.length;
      const outputLen = cleaned.length;

      // Anti-hallucination guards. Cleanup may only remove content, so the
      // output should never be larger than the input (modest leeway for
      // heading-level adjustments). It should also not shrink so much that
      // the AI clearly threw away real content.
      const grewSuspiciously = outputLen > inputLen * 1.05;
      const shrankSuspiciously = outputLen < inputLen * 0.4;

      if (grewSuspiciously) {
        fallbackUsed = true;
        aiWarnings.push(
          `Cleanup output (${outputLen} chars) was larger than input (${inputLen} chars); used deterministic markdown to avoid potential hallucination.`,
        );
        if (IS_DEV) {
          console.warn(`[page2md]   ⚠ Cleanup output GREW (${inputLen} → ${outputLen} chars) — rejecting and using deterministic markdown.`);
        }
      } else if (shrankSuspiciously) {
        fallbackUsed = true;
        aiWarnings.push(
          `Cleanup output (${outputLen} chars) was less than 40% of input (${inputLen} chars); used deterministic markdown to avoid losing real content.`,
        );
        if (IS_DEV) {
          console.warn(`[page2md]   ⚠ Cleanup output SHRANK suspiciously (${inputLen} → ${outputLen} chars) — rejecting and using deterministic markdown.`);
        }
      } else {
        markdownBody = cleaned;
        if (parsed.warnings) {
          aiWarnings.push(...parsed.warnings);
        }
        if (IS_DEV) {
          const removedBytes = inputLen - outputLen;
          const removedItems = parsed.removed?.length ?? 0;
          console.log(
            `[page2md]   ✓ Cleanup accepted: ${inputLen} → ${outputLen} chars (-${removedBytes} bytes, ${removedItems} item(s) removed)`,
          );
        }
      }
    } catch (err) {
      fallbackUsed = true;
      aiWarnings.push("AI cleanup pass failed; serving deterministic markdown without cleanup.");
      if (IS_DEV) {
        console.error(`[page2md]   convertRegionWithAi — cleanup AI call or parse FAILED, using deterministic markdown. Error:`, err);
      }
    }
  }

  if (!markdownBody.trim()) {
    markdownBody = deterministicMarkdown;
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
