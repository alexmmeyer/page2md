export type SourceType = "url" | "html" | "paste";
/** Includes extension-only `"tab"` (current browser page). */
export type ConversionSourceType = SourceType | "tab";
export type OutputFormat = "markdown" | "json";

export interface ConversionRequest {
  sourceType: SourceType;
  source: string;
  outputFormat: OutputFormat;
  mainContentOnly: boolean;
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
  outputFormat: OutputFormat;
  markdown?: string;
  json?: ConversionJsonOutput;
  report: ExtractionReport;
  meta: ConversionMeta;
}
