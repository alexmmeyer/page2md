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
