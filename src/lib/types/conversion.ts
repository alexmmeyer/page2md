export type SourceType = "url" | "html" | "paste";
/** Includes extension-only `"tab"` (current browser page). */
export type ConversionSourceType = SourceType | "tab";
export type OutputFormat = "markdown" | "json";
export type ConversionEngine = "deterministic" | "ai";
export type AiStage = "detect" | "convert";

export type ExtractionRegionKind =
  | "main"
  | "article"
  | "content"
  | "navigation"
  | "header"
  | "footer"
  | "sidebar"
  | "toc"
  | "section";

export interface ExtractionRegion {
  id: string;
  label: string;
  description?: string;
  previewText?: string;
  kind: ExtractionRegionKind;
  textLength: number;
  linkDensity: number;
  score: number;
}

/**
 * A visually-rich region candidate produced by the vision-aware extractor.
 * The AI receives these along with a full-page screenshot and decides which
 * to surface to the user.
 */
export interface VisibleRegionCandidate {
  /** Stable index used to address the candidate in AI responses. */
  ref: string;
  /** CSS-ish selector path for re-finding the element on a fresh extraction. */
  selectorPath: string;
  tag: string;
  role?: string;
  ariaLabel?: string;
  className?: string;
  bbox: { x: number; y: number; width: number; height: number };
  bgColor: string;
  textColor: string;
  borderTop: string;
  borderLeft: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  position: string;
  depth: number;
  textLength: number;
  textPreview: string;
  linkCount: number;
  linkDensity: number;
  /** Refs of immediate child candidates (for nesting awareness). */
  childRefs: string[];
}

export interface AiVisionDetectInput {
  title: string;
  candidates: VisibleRegionCandidate[];
  screenshotPngBase64: string;
  viewport: { width: number; height: number };
  fullPageHeight: number;
  report: ExtractionReport;
}

export interface AiRegionCandidate {
  id: string;
  label: string;
  description?: string;
  sourceRegionId?: string;
  confidence: number;
  rationale: string;
  score: number;
}

export interface ConversionRequest {
  sourceType: SourceType;
  source: string;
  outputFormat: OutputFormat;
  mainContentOnly: boolean;
  selectedRegionId?: string;
  detectOnly?: boolean;
  engine?: ConversionEngine;
}

export interface AiConversionRequest {
  engine: "ai";
  stage: AiStage;
  sourceType: ConversionSourceType;
  source: string;
  outputFormat: OutputFormat;
  selectedRegionId?: string;
  selectedRegionHtml?: string;
  preDetectedRegions?: ExtractionRegion[];
  titleHint?: string;
}

export interface ExtractionReport {
  collapsiblesAttempted: number;
  collapsiblesOpened: number;
  sequentialGroupsDetected: number;
  warnings: string[];
}

export interface ConversionMeta {
  sourceType: ConversionSourceType;
  source: string;
  title: string;
  convertedAt: string;
  selectedRegionId?: string;
  selectedRegionLabel?: string;
}

export interface ConversionJsonOutput {
  meta: ConversionMeta;
  report: ExtractionReport;
  markdown: string;
  sections: Array<{
    level: number;
    title: string;
  }>;
  blocks: ConversionBlock[];
}

export type ConversionBlock =
  | {
      type: "heading";
      level: number;
      text: string;
    }
  | {
      type: "paragraph";
      text: string;
    }
  | {
      type: "list";
      ordered: boolean;
      items: string[];
    }
  | {
      type: "code";
      language: string;
      code: string;
    }
  | {
      type: "table";
      headers: string[];
      rows: string[][];
    };

export interface ConversionResponse {
  engine?: ConversionEngine;
  outputFormat: OutputFormat;
  markdown?: string;
  json?: ConversionJsonOutput;
  report: ExtractionReport;
  meta: ConversionMeta;
  regions?: ExtractionRegion[];
  defaultRegionId?: string;
  selectedRegionId?: string;
  selectedRegionLabel?: string;
}

export interface AiConversionResponse extends ConversionResponse {
  engine: "ai";
  stage: AiStage;
  aiRegions?: AiRegionCandidate[];
  selectedAiRegionId?: string;
  selectedAiRegionLabel?: string;
  model?: string;
  fallbackUsed?: boolean;
  aiWarnings?: string[];
}
